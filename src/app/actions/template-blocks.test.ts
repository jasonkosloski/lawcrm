/**
 * Integration tests for the template block library actions.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({
  getCurrentUserId: vi.fn(),
  requireUser: vi.fn(),
}));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn(),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

import { requirePermission } from "@/lib/permission-check";
import { getCurrentUserId, requireUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import {
  deleteTemplateBlock,
  listBlockUsage,
  saveTemplateBlock,
  setTemplateBlockActive,
} from "@/app/actions/template-blocks";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

let userId: string;

const para = (t: string) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const doc = (t = "Sincerely") => ({ type: "doc", content: [para(t)] });
const blockInput = (over: Record<string, unknown> = {}) => ({
  key: "closing",
  name: "Closing",
  content: doc(),
  ...over,
});

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  const { firmId } = await seedFirm();
  userId = (await seedUser({ firmId, name: "Test Attorney" })).userId;
  vi.mocked(requirePermission).mockResolvedValue(userId);
  vi.mocked(getCurrentUserId).mockResolvedValue(userId);
  vi.mocked(requireUser).mockResolvedValue(userId);
});

const logCount = (title: string) => prisma.activityLog.count({ where: { title } });

const seedTemplateUsing = (blockId: string, name = "Uses block", isActive = true) =>
  prisma.documentTemplate.create({
    data: {
      name,
      category: "general",
      isActive,
      content: { type: "doc", content: [{ type: "block", attrs: { blockId } }] },
      createdById: userId,
    },
  });

describe("saveTemplateBlock", () => {
  test("create asks for create key and logs once", async () => {
    const r = await saveTemplateBlock(blockInput());
    expect(r.ok).toBe(true);
    expect(requirePermission).toHaveBeenCalledWith("documents.template.create");
    expect(await logCount('Block "Closing" created')).toBe(1);
  });

  test("update asks for edit key and logs once", async () => {
    const c = await saveTemplateBlock(blockInput());
    if (!c.ok) throw new Error(c.error);
    vi.mocked(requirePermission).mockClear();
    const r = await saveTemplateBlock(blockInput({ id: c.id, name: "Closing v2" }));
    expect(r.ok).toBe(true);
    expect(requirePermission).toHaveBeenCalledWith("documents.template.edit");
    expect(await logCount('Block "Closing v2" updated')).toBe(1);
  });

  test("duplicate key is refused", async () => {
    await saveTemplateBlock(blockInput());
    const r = await saveTemplateBlock(blockInput({ name: "Other" }));
    expect(r).toEqual({ ok: false, error: "That key is already used by another block." });
  });

  test("bad key format is refused", async () => {
    const r = await saveTemplateBlock(blockInput({ key: "Bad Key" }));
    expect(r.ok).toBe(false);
  });

  test("block content cannot contain a block ref", async () => {
    const r = await saveTemplateBlock(
      blockInput({
        content: { type: "doc", content: [{ type: "block", attrs: { blockId: "x" } }] },
      }),
    );
    expect(r.ok).toBe(false);
  });

  test("stale expectedUpdatedAt is refused", async () => {
    const c = await saveTemplateBlock(blockInput());
    if (!c.ok) throw new Error(c.error);
    const row = await prisma.templateBlock.findUniqueOrThrow({ where: { id: c.id } });
    const r = await saveTemplateBlock(
      blockInput({
        id: c.id,
        expectedUpdatedAt: new Date(row.updatedAt.getTime() - 5000).toISOString(),
      }),
    );
    expect(r).toEqual({
      ok: false,
      error: "Someone else saved this block — reload to see their changes.",
    });
  });

  test("a save returns the new version, which the next save can send", async () => {
    const c = await saveTemplateBlock(blockInput());
    if (!c.ok) throw new Error(c.error);
    const row = await prisma.templateBlock.findUniqueOrThrow({ where: { id: c.id } });
    expect(c.updatedAt).toBe(row.updatedAt.toISOString());
    const u = await saveTemplateBlock(blockInput({ id: c.id, expectedUpdatedAt: c.updatedAt }));
    if (!u.ok) throw new Error(u.error);
    const again = await saveTemplateBlock(
      blockInput({ id: c.id, name: "Renamed", expectedUpdatedAt: u.updatedAt }),
    );
    expect(again.ok).toBe(true);
  });
});

describe("concurrency and input", () => {
  test("two concurrent creates of one key: one ok, one friendly error", async () => {
    const rs = await Promise.all([
      saveTemplateBlock(blockInput({ name: "A" })),
      saveTemplateBlock(blockInput({ name: "B" })),
    ]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.filter((r) => !r.ok)).toEqual([
      { ok: false, error: "That key is already used by another block." },
    ]);
  });

  test("unparsable expectedUpdatedAt is a friendly error", async () => {
    const c = await saveTemplateBlock(blockInput());
    if (!c.ok) throw new Error(c.error);
    const r = await saveTemplateBlock(blockInput({ id: c.id, expectedUpdatedAt: "garbage" }));
    expect(r.ok).toBe(false);
  });
});

describe("archive and delete", () => {
  test("archive asks for edit key, logs, and works while referenced", async () => {
    const c = await saveTemplateBlock(blockInput());
    if (!c.ok) throw new Error(c.error);
    await seedTemplateUsing(c.id);
    vi.mocked(requirePermission).mockClear();
    const r = await setTemplateBlockActive(c.id, false);
    expect(r.ok).toBe(true);
    expect(requirePermission).toHaveBeenCalledWith("documents.template.edit");
    expect(await logCount('Block "Closing" archived')).toBe(1);
  });

  test("delete is refused while referenced and names the template", async () => {
    const c = await saveTemplateBlock(blockInput());
    if (!c.ok) throw new Error(c.error);
    await seedTemplateUsing(c.id, "Demand letter", false);
    vi.mocked(requirePermission).mockClear();
    const r = await deleteTemplateBlock(c.id);
    expect(requirePermission).toHaveBeenCalledWith("documents.template.delete");
    expect(r).toEqual({
      ok: false,
      error:
        "This block is used by: Demand letter. Archive it instead, or remove it from those templates first.",
    });
    expect(await prisma.templateBlock.count()).toBe(1);
  });

  test("delete succeeds when unreferenced and logs once", async () => {
    const c = await saveTemplateBlock(blockInput());
    if (!c.ok) throw new Error(c.error);
    const r = await deleteTemplateBlock(c.id);
    expect(r.ok).toBe(true);
    expect(await prisma.templateBlock.count()).toBe(0);
    expect(await logCount('Block "Closing" deleted')).toBe(1);
  });
});

describe("listBlockUsage", () => {
  test("lists active and archived templates referencing the block", async () => {
    const c = await saveTemplateBlock(blockInput());
    if (!c.ok) throw new Error(c.error);
    const a = await seedTemplateUsing(c.id, "A");
    const b = await seedTemplateUsing(c.id, "B", false);
    await prisma.documentTemplate.create({
      data: { name: "Legacy", category: "general", body: "x", createdById: userId },
    });
    const usage = await listBlockUsage(c.id);
    expect(usage.map((u) => u.id).sort()).toEqual([a.id, b.id].sort());
    expect(requireUser).toHaveBeenCalled();
  });
});

describe("deleteTemplateBlock and the document style", () => {
  test("refuses while document_styles references the block", async () => {
    const { firmId } = await prisma.user
      .findUniqueOrThrow({ where: { id: userId }, select: { firmId: true } })
      .then((u) => ({ firmId: u.firmId as string }));
    const block = await prisma.templateBlock.create({
      data: { key: "lh", name: "Letterhead", content: doc() },
    });
    await prisma.documentStyle.create({ data: { firmId, continuationBlockId: block.id } });
    const r = await deleteTemplateBlock(block.id);
    expect(r).toEqual({
      ok: false,
      error: "This block is used by the firm's document style. Choose another block there first.",
    });
    expect(await prisma.templateBlock.count({ where: { id: block.id } })).toBe(1);
  });
});
