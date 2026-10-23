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

/** When on, each graph load waits (up to 300ms) for a second save to load
 *  too, so two racing saves overlap unless the lock makes them take turns. */
const race = vi.hoisted(() => ({ on: false, waiting: [] as (() => void)[] }));
vi.mock("@/lib/templates/block-graph-db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/templates/block-graph-db")>();
  return {
    ...real,
    loadAllBlocks: async (...args: Parameters<typeof real.loadAllBlocks>) => {
      const blocks = await real.loadAllBlocks(...args);
      if (race.on) {
        if (race.waiting.length > 0) race.waiting.splice(0).forEach((go) => go());
        else
          await new Promise<void>((go) => {
            race.waiting.push(go);
            setTimeout(go, 300);
          });
      }
      return blocks;
    },
  };
});

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

  test("creates a block with appliesTo both by default and saves matter", async () => {
    const c = await saveTemplateBlock(blockInput());
    if (!c.ok) throw new Error(c.error);
    expect((await prisma.templateBlock.findUnique({ where: { id: c.id } }))?.appliesTo).toBe(
      "both",
    );
    const u = await saveTemplateBlock(blockInput({ id: c.id, appliesTo: "matter" }));
    expect(u.ok).toBe(true);
    expect((await prisma.templateBlock.findUnique({ where: { id: c.id } }))?.appliesTo).toBe(
      "matter",
    );
    // Absent on update leaves the scope unchanged.
    await saveTemplateBlock(blockInput({ id: c.id, name: "Closing v2" }));
    expect((await prisma.templateBlock.findUnique({ where: { id: c.id } }))?.appliesTo).toBe(
      "matter",
    );
  });

  test("refuses a block whose own fields don't fit its scope", async () => {
    const r = await saveTemplateBlock(
      blockInput({
        appliesTo: "both",
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "field", attrs: { path: "matter.caseNumber" } }],
            },
          ],
        },
      }),
    );
    expect(r).toEqual({
      ok: false,
      error: "These fields don't fit a matter-and-lead block: Case number.",
    });
    expect(await prisma.templateBlock.count()).toBe(0);
  });

  test("refuses an invalid appliesTo", async () => {
    const r = await saveTemplateBlock(blockInput({ appliesTo: "client" }));
    expect(r.ok).toBe(false);
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

  test("a block ref to a missing block is refused", async () => {
    const r = await saveTemplateBlock(
      blockInput({
        content: { type: "doc", content: [{ type: "block", attrs: { blockId: "x" } }] },
      }),
    );
    expect(r).toEqual({ ok: false, error: "A referenced block no longer exists." });
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
        "This block is used by: Demand letter. Archive it instead, or remove it from those templates and blocks first.",
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

describe("deleteTemplateBlock court format protection", () => {
  test("refused while a court format references the block on either side, before other checks", async () => {
    const a = (await saveTemplateBlock(blockInput({ key: "blk_a", name: "A" }))) as { id: string };
    const b = (await saveTemplateBlock(blockInput({ key: "blk_b", name: "B" }))) as { id: string };
    const cf = await prisma.courtFormat.create({
      data: {
        name: "CO District",
        blocks: { create: [{ blockId: a.id, replacementBlockId: b.id }] },
      },
    });
    const firm = await prisma.firm.findFirstOrThrow();
    await prisma.documentStyle.create({ data: { firmId: firm.id, letterheadBlockId: a.id } });
    const msg = "This block is used by court format(s): CO District. Remove it there first.";
    expect(await deleteTemplateBlock(a.id)).toEqual({ ok: false, error: msg });
    expect(await deleteTemplateBlock(b.id)).toEqual({ ok: false, error: msg });
    expect(await prisma.templateBlock.count()).toBeGreaterThanOrEqual(2);
    await prisma.courtFormat.delete({ where: { id: cf.id } });
    expect((await deleteTemplateBlock(b.id)).ok).toBe(true);
  });
});

describe("court format usage of a block", () => {
  const mkFormat = (blockId: string, replacementBlockId: string, name = "CO District") =>
    prisma.courtFormat.create({
      data: { name, blocks: { create: [{ blockId, replacementBlockId }] } },
    });

  test("listBlockUsage lists court formats on either side with a kind", async () => {
    const a = await saveTemplateBlock(blockInput());
    const b = await saveTemplateBlock(blockInput({ key: "other", name: "Other" }));
    if (!a.ok || !b.ok) throw new Error("seed");
    const t = await seedTemplateUsing(a.id, "Tpl");
    const f = await mkFormat(a.id, b.id);
    expect(await listBlockUsage(a.id)).toEqual([
      { id: t.id, name: "Tpl", kind: "template" },
      { id: f.id, name: "CO District", kind: "court_format" },
    ]);
    expect(await listBlockUsage(b.id)).toEqual([
      { id: f.id, name: "CO District", kind: "court_format" },
    ]);
  });

  test("archiving is refused while a court format uses the block; restore is fine", async () => {
    const a = await saveTemplateBlock(blockInput());
    const b = await saveTemplateBlock(blockInput({ key: "other", name: "Other" }));
    if (!a.ok || !b.ok) throw new Error("seed");
    await mkFormat(a.id, b.id);
    for (const id of [a.id, b.id]) {
      expect(await setTemplateBlockActive(id, false)).toEqual({
        ok: false,
        error: "This block is used by court format(s): CO District. Remove it there first.",
      });
      expect((await prisma.templateBlock.findUniqueOrThrow({ where: { id } })).isActive).toBe(true);
    }
    await prisma.templateBlock.update({ where: { id: a.id }, data: { isActive: false } });
    expect(await setTemplateBlockActive(a.id, true)).toEqual({ ok: true });
  });
});

// ── Nested blocks ──────────────────────────────────────────────────────

const ref = (blockId: string) => ({ type: "block", attrs: { blockId } });
const docWith = (...ids: string[]) => ({ type: "doc", content: [para("x"), ...ids.map(ref)] });

/** Create a block through the action; throws on refusal. */
async function mk(name: string, over: Record<string, unknown> = {}): Promise<string> {
  const r = await saveTemplateBlock(
    blockInput({
      key: `blk_${name.toLowerCase().replace(/\W/g, "_")}`,
      name,
      content: doc(),
      ...over,
    }),
  );
  if (!r.ok) throw new Error(r.error);
  return r.id;
}

/** Save an existing block's content (keeping its key and name). */
async function setChildren(id: string, ...ids: string[]) {
  const b = await prisma.templateBlock.findUniqueOrThrow({ where: { id } });
  return saveTemplateBlock({ id, key: b.key, name: b.name, content: docWith(...ids) });
}

const seedTemplate = (blockId: string, name: string, appliesTo: string, isActive = true) =>
  prisma.documentTemplate.create({
    data: {
      name,
      category: "general",
      appliesTo,
      isActive,
      content: { type: "doc", content: [ref(blockId)] },
      createdById: userId,
    },
  });

describe("nested blocks: save rules", () => {
  test("a block can contain a block", async () => {
    const b = await mk("B");
    const a = await mk("A", { content: docWith(b) });
    const row = await prisma.templateBlock.findUniqueOrThrow({ where: { id: a } });
    expect(JSON.stringify(row.content)).toContain(b);
  });

  test("refuses a block that includes itself", async () => {
    const a = await mk("A");
    expect(await setChildren(a, a)).toEqual({ ok: false, error: "A can't include itself." });
  });

  test("refuses a direct loop", async () => {
    const b = await mk("B");
    await mk("A", { content: docWith(b) });
    const a = (await prisma.templateBlock.findFirstOrThrow({ where: { name: "A" } })).id;
    expect(await setChildren(b, a)).toEqual({
      ok: false,
      error: "A already includes B, so B can't include A.",
    });
  });

  test("refuses a loop through two levels", async () => {
    const c = await mk("C");
    const b = await mk("B", { content: docWith(c) });
    const a = await mk("A", { content: docWith(b) });
    // C → A would close A → B → C → A; A, the inserted child, already includes C.
    expect(await setChildren(c, a)).toEqual({
      ok: false,
      error: "A already includes C, so C can't include A.",
    });
  });

  test("refuses nesting more than 5 deep", async () => {
    const b5 = await mk("B5");
    const b4 = await mk("B4", { content: docWith(b5) });
    const b3 = await mk("B3", { content: docWith(b4) });
    const b2 = await mk("B2", { content: docWith(b3) });
    const b1 = await mk("B1", { content: docWith(b2) });
    const six = await mk("Six");
    const deep = { ok: false, error: "This would nest blocks more than 5 deep." };
    expect(await setChildren(b5, six)).toEqual(deep);
    const top = await mk("Top");
    expect(await setChildren(top, b1)).toEqual(deep);
    // A new block above the top is refused too.
    expect(
      await saveTemplateBlock(blockInput({ key: "new_top", name: "New", content: docWith(b1) })),
    ).toEqual(deep);
  });

  test("a new block skips the loop check but not depth or scope", async () => {
    const m = await mk("M", { appliesTo: "matter" });
    expect(
      await saveTemplateBlock(blockInput({ key: "new_one", name: "New", content: docWith(m) })),
    ).toEqual({
      ok: false,
      error: "M applies to matter only, so it can't go in a matter-and-lead block.",
    });
    const plain = await mk("Plain");
    expect(
      (
        await saveTemplateBlock(
          blockInput({ key: "new_two", name: "New", content: docWith(plain) }),
        )
      ).ok,
    ).toBe(true);
  });

  test("refuses a matter block inside a both block", async () => {
    const m = await mk("M", { appliesTo: "matter" });
    const host = await mk("Host");
    expect(await setChildren(host, m)).toEqual({
      ok: false,
      error: "M applies to matter only, so it can't go in a matter-and-lead block.",
    });
    // A matter host takes it.
    const b = await prisma.templateBlock.findUniqueOrThrow({ where: { id: host } });
    const r = await saveTemplateBlock({
      id: host,
      key: b.key,
      name: b.name,
      appliesTo: "matter",
      content: docWith(m),
    });
    expect(r.ok).toBe(true);
  });

  test("refuses narrowing a block used by a both template, archived ones included", async () => {
    const c = await mk("Child");
    await seedTemplate(c, "Old both", "both", false);
    const r = await saveTemplateBlock(
      blockInput({ id: c, key: "blk_child", name: "Child", appliesTo: "lead" }),
    );
    expect(r).toEqual({
      ok: false,
      error: "Old both applies to matter-and-lead and uses this block — change it first.",
    });
    // A matter template doesn't stop narrowing to matter.
    await prisma.documentTemplate.deleteMany();
    await seedTemplate(c, "Matter tpl", "matter");
    const ok = await saveTemplateBlock(
      blockInput({ id: c, key: "blk_child", name: "Child", appliesTo: "matter" }),
    );
    expect(ok.ok).toBe(true);
  });

  test("refuses narrowing a block used by a both block", async () => {
    const c = await mk("Child");
    const p = await mk("Parent", { content: docWith(c) });
    await prisma.templateBlock.update({ where: { id: p }, data: { isActive: false } });
    const r = await saveTemplateBlock(
      blockInput({ id: c, key: "blk_child", name: "Child", appliesTo: "matter" }),
    );
    expect(r).toEqual({
      ok: false,
      error: "Parent applies to matter-and-lead and uses this block — change it first.",
    });
  });
});

describe("nested blocks: usage and delete", () => {
  test("listBlockUsage lists parent blocks", async () => {
    const c = await mk("Child");
    const p = await mk("Parent", { content: docWith(c) });
    const q = await mk("Archived parent", { content: docWith(c) });
    await prisma.templateBlock.update({ where: { id: q }, data: { isActive: false } });
    const t = await seedTemplateUsing(c, "Tpl");
    expect(await listBlockUsage(c)).toEqual([
      { id: t.id, name: "Tpl", kind: "template" },
      { id: q, name: "Archived parent", kind: "block" },
      { id: p, name: "Parent", kind: "block" },
    ]);
  });

  test("delete is refused while another block uses it", async () => {
    const c = await mk("Child");
    const p = await mk("Parent", { content: docWith(c) });
    await prisma.templateBlock.update({ where: { id: p }, data: { isActive: false } });
    await seedTemplateUsing(c, "Tpl");
    expect(await deleteTemplateBlock(c)).toEqual({
      ok: false,
      error:
        "This block is used by: Tpl, Parent. Archive it instead, or remove it from those templates and blocks first.",
    });
    expect(await prisma.templateBlock.count({ where: { id: c } })).toBe(1);
  });
});

describe("nested blocks: concurrency", () => {
  test("two saves that would form a loop: exactly one succeeds", async () => {
    const a = await mk("A");
    const b = await mk("B");
    race.on = true;
    const rs = await Promise.all([setChildren(a, b), setChildren(b, a)]).finally(() => {
      race.on = false;
    });
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    const errs = rs.filter((r) => !r.ok).map((r) => (r as { error: string }).error);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/^(A|B) already includes (A|B), so (A|B) can't include (A|B)\.$/);
    // Whichever won, dropping the edge from A and B saves.
    expect((await setChildren(a)).ok).toBe(true);
    expect((await setChildren(b, a)).ok).toBe(true);
  });
});
