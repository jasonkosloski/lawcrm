/**
 * Integration tests for the court format actions.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/firm", () => ({ getCurrentFirm: vi.fn() }));

import { revalidatePath } from "next/cache";
import { getCurrentFirm } from "@/lib/firm";
import { requirePermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import {
  deleteCourtFormat,
  saveCourtFormat,
  setCourtFormatActive,
} from "@/app/actions/court-formats";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

let userId: string;
let blockA: string;
let blockB: string;
let blockC: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

const mkBlock = (key: string, isActive = true) =>
  prisma.templateBlock.create({
    data: {
      key,
      name: key,
      isActive,
      content: { type: "doc", content: [{ type: "paragraph" }] },
      createdById: userId,
    },
  });

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  const { firmId } = await seedFirm();
  userId = (await seedUser({ firmId, name: "Test Attorney" })).userId;
  vi.mocked(requirePermission).mockResolvedValue(userId);
  vi.mocked(getCurrentFirm).mockResolvedValue({ id: firmId } as never);
  blockA = (await mkBlock("block_a")).id;
  blockB = (await mkBlock("block_b", false)).id;
  blockC = (await mkBlock("block_c")).id;
});

const base = {
  name: "Colorado District",
  courtSystem: "state" as const,
  fontKey: null,
  marginTopIn: null,
  marginRightIn: null,
  marginBottomIn: null,
  marginLeftIn: null,
  pageNumbers: null,
  paperSize: "letter" as const,
  replacements: [] as { blockId: string; replacementBlockId: string }[],
};

async function create(over: Record<string, unknown> = {}) {
  const r = await saveCourtFormat({ ...base, ...over });
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe("saveCourtFormat", () => {
  test("create gates on .add, stores rows, logs and revalidates", async () => {
    const r = await create({
      marginTopIn: 1.5,
      paperSize: "legal",
      replacements: [{ blockId: blockA, replacementBlockId: blockB }],
    });
    expect(requirePermission).toHaveBeenCalledWith("court_formats.add");
    const row = await prisma.courtFormat.findUniqueOrThrow({
      where: { id: r.id },
      include: { blocks: true },
    });
    expect(row.paperSize).toBe("legal");
    expect(Number(row.marginTopIn)).toBe(1.5);
    expect(row.blocks).toHaveLength(1);
    expect(
      await prisma.activityLog.count({
        where: { title: 'Court format "Colorado District" created' },
      }),
    ).toBe(1);
    expect(revalidatePath).toHaveBeenCalledWith("/settings/court-formats");
    expect(revalidatePath).toHaveBeenCalledWith("/settings/venues");
  });

  test("denied permission writes nothing", async () => {
    vi.mocked(requirePermission).mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(saveCourtFormat(base)).rejects.toThrow("NEXT_REDIRECT");
    expect(await prisma.courtFormat.count()).toBe(0);
  });

  test("update gates on .edit", async () => {
    const c = await create();
    vi.mocked(requirePermission).mockClear();
    await saveCourtFormat({ ...base, id: c.id, expectedUpdatedAt: c.updatedAt });
    expect(requirePermission).toHaveBeenCalledWith("court_formats.edit");
  });

  test.each([
    ["body size low", { styleOverrides: { body: { sizePt: 7 } } }],
    ["body size high", { styleOverrides: { body: { sizePt: 73 } } }],
    ["space after", { styleOverrides: { body: { spaceAfterPt: 73 } } }],
    ["margin low", { marginLeftIn: 0.49 }],
    ["margin high", { marginRightIn: 2.01 }],
    ["margin decimals", { marginTopIn: 1.001 }],
    ["line spacing", { styleOverrides: { body: { lineSpacing: "triple" } } }],
    ["paper", { paperSize: "a4" }],
    ["system", { courtSystem: "tribal" }],
    ["font", { fontKey: "comic" }],
    ["name blank", { name: "  " }],
  ])("rejects out-of-range %s", async (_n, over) => {
    const r = await saveCourtFormat({ ...base, ...over } as never);
    expect(r.ok).toBe(false);
    expect(await prisma.courtFormat.count()).toBe(0);
  });

  test("accepts range edges", async () => {
    const r = await saveCourtFormat({
      ...base,
      styleOverrides: { body: { sizePt: 8, spaceAfterPt: 72 } },
      marginTopIn: 0.5,
      marginBottomIn: 2,
    });
    expect(r.ok).toBe(true);
  });

  test("a Body override is stored and mirrored to the legacy columns", async () => {
    const r = await create({
      styleOverrides: { body: { sizePt: 14, lineSpacing: "double", spaceAfterPt: 6 } },
    });
    const row = await prisma.courtFormat.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.styleOverrides).toEqual({
      body: { sizePt: 14, lineSpacing: "double", spaceAfterPt: 6 },
    });
    expect([row.fontSizeHalfPt, row.lineSpacing, row.spaceAfterPt]).toEqual([28, "double", 6]);
  });

  test("exact Body line spacing and unset fields leave the legacy columns null; empty styles are dropped", async () => {
    const r = await create({
      styleOverrides: { body: { lineSpacing: { exactPt: 24 } }, caption: {} },
    });
    const row = await prisma.courtFormat.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.styleOverrides).toEqual({ body: { lineSpacing: { exactPt: 24 } } });
    expect([row.fontSizeHalfPt, row.lineSpacing, row.spaceAfterPt]).toEqual([null, null, null]);
  });

  test("an override for a style the firm does not have is refused", async () => {
    const r = await saveCourtFormat({ ...base, styleOverrides: { nope: { bold: true } } });
    expect(r).toEqual({ ok: false, error: "No style called nope." });
    expect(await prisma.courtFormat.count()).toBe(0);
  });

  test("clearing the Body override clears the legacy columns on update", async () => {
    const c = await create({ styleOverrides: { body: { sizePt: 14 } } });
    const r = await saveCourtFormat({
      ...base,
      id: c.id,
      expectedUpdatedAt: c.updatedAt,
      styleOverrides: {},
    });
    expect(r.ok).toBe(true);
    const row = await prisma.courtFormat.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.styleOverrides).toEqual({});
    expect(row.fontSizeHalfPt).toBeNull();
  });

  test("self-replacement and duplicate source refused", async () => {
    expect(
      await saveCourtFormat({
        ...base,
        replacements: [{ blockId: blockA, replacementBlockId: blockA }],
      }),
    ).toEqual({ ok: false, error: "A block can't replace itself." });
    expect(
      await saveCourtFormat({
        ...base,
        replacements: [
          { blockId: blockA, replacementBlockId: blockB },
          { blockId: blockA, replacementBlockId: blockC },
        ],
      }),
    ).toEqual({ ok: false, error: "Each block can be replaced only once per court format." });
    expect(await prisma.courtFormat.count()).toBe(0);
  });

  test("unknown block refused", async () => {
    const r = await saveCourtFormat({
      ...base,
      replacements: [{ blockId: blockA, replacementBlockId: "nope" }],
    });
    expect(r.ok).toBe(false);
  });

  test("duplicate name gives friendly copy on create and update", async () => {
    await create();
    expect(await saveCourtFormat(base)).toEqual({
      ok: false,
      error: "A court format with that name already exists.",
    });
    const other = await create({ name: "Other" });
    expect(
      await saveCourtFormat({
        ...base,
        id: other.id,
        expectedUpdatedAt: other.updatedAt,
      }),
    ).toEqual({ ok: false, error: "A court format with that name already exists." });
  });

  test("update replaces rows wholesale and returns a new updatedAt", async () => {
    const c = await create({ replacements: [{ blockId: blockA, replacementBlockId: blockB }] });
    const r = await saveCourtFormat({
      ...base,
      id: c.id,
      name: "Renamed",
      styleOverrides: { body: { sizePt: 13 } },
      expectedUpdatedAt: c.updatedAt,
      replacements: [{ blockId: blockC, replacementBlockId: blockA }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.updatedAt).not.toBe(c.updatedAt);
    const row = await prisma.courtFormat.findUniqueOrThrow({
      where: { id: c.id },
      include: { blocks: true },
    });
    expect(row.name).toBe("Renamed");
    expect(row.updatedAt.toISOString()).toBe(r.updatedAt);
    expect(row.blocks.map((b) => [b.blockId, b.replacementBlockId])).toEqual([[blockC, blockA]]);
  });

  test("stale save writes nothing: format and rows unchanged", async () => {
    const c = await create({ replacements: [{ blockId: blockA, replacementBlockId: blockB }] });
    const r = await saveCourtFormat({
      ...base,
      id: c.id,
      name: "Stale",
      expectedUpdatedAt: new Date(Date.now() - 60_000).toISOString(),
      replacements: [],
    });
    expect(r).toEqual({
      ok: false,
      error: "Someone else saved this court format — reload to see their changes.",
    });
    const row = await prisma.courtFormat.findUniqueOrThrow({
      where: { id: c.id },
      include: { blocks: true },
    });
    expect(row.name).toBe("Colorado District");
    expect(row.blocks).toHaveLength(1);
  });
});

describe("setCourtFormatActive", () => {
  test("gates on .edit, archives and restores even while venues use it", async () => {
    const c = await create();
    await prisma.venue.create({
      data: { name: "V", nameKey: "v", state: "CO", courtFormatId: c.id },
    });
    expect(await setCourtFormatActive(c.id, false)).toEqual({ ok: true });
    expect(requirePermission).toHaveBeenCalledWith("court_formats.edit");
    expect((await prisma.courtFormat.findUniqueOrThrow({ where: { id: c.id } })).isActive).toBe(
      false,
    );
    await setCourtFormatActive(c.id, true);
    expect((await prisma.courtFormat.findUniqueOrThrow({ where: { id: c.id } })).isActive).toBe(
      true,
    );
  });
});

describe("deleteCourtFormat", () => {
  test("refused with venue names (active and archived)", async () => {
    const c = await create();
    await prisma.venue.create({
      data: { name: "Aurora", nameKey: "aurora", state: "CO", courtFormatId: c.id },
    });
    await prisma.venue.create({
      data: {
        name: "Denver",
        nameKey: "denver",
        state: "CO",
        isActive: false,
        courtFormatId: c.id,
      },
    });
    expect(await deleteCourtFormat(c.id)).toEqual({
      ok: false,
      error:
        "This court format is used by: Aurora, Denver. Archive it instead, or move those venues first.",
    });
    expect(requirePermission).toHaveBeenCalledWith("court_formats.delete");
    expect(await prisma.courtFormat.count()).toBe(1);
  });

  test("deletes an unused format and its rows", async () => {
    const c = await create({ replacements: [{ blockId: blockA, replacementBlockId: blockB }] });
    expect(await deleteCourtFormat(c.id)).toEqual({ ok: true });
    expect(await prisma.courtFormat.count()).toBe(0);
    expect(await prisma.courtFormatBlock.count()).toBe(0);
  });
});

describe("foreign-key races", () => {
  const fk = () => Object.assign(new Error("fk"), { code: "P2003" });
  const gone = { ok: false, error: "That block no longer exists — reload." };

  test("create returns friendly copy when a block vanishes before the write", async () => {
    const spy = vi.spyOn(prisma.courtFormat, "create").mockRejectedValueOnce(fk());
    expect(await saveCourtFormat(base)).toEqual(gone);
    spy.mockRestore();
  });

  test("update returns friendly copy when a block vanishes before the write", async () => {
    const c = await create();
    const spy = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(fk());
    expect(await saveCourtFormat({ ...base, id: c.id, expectedUpdatedAt: c.updatedAt })).toEqual(
      gone,
    );
    spy.mockRestore();
  });
});
