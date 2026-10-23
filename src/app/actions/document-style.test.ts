/**
 * Integration tests for the document style save action.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/firm", () => ({ getCurrentFirm: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({ requirePermission: vi.fn() }));

import { revalidatePath } from "next/cache";
import { getCurrentFirm } from "@/lib/firm";
import { requirePermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import { getDocumentStyle } from "@/lib/templates/document-style";
import { DEFAULT_DOCUMENT_STYLE } from "@/lib/templates/page-style";
import { saveDocumentStyle, saveParagraphStyles } from "@/app/actions/document-style";
import { defaultParagraphStyles, type ParagraphStyle } from "@/lib/templates/paragraph-styles";
import { resetDb, seedFirm, seedUser } from "@/test/integration-helpers";

let firmId: string;
let userId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  ({ firmId } = await seedFirm());
  userId = (await seedUser({ firmId, name: "Test Attorney" })).userId;
  vi.mocked(getCurrentFirm).mockResolvedValue({ id: firmId } as never);
  vi.mocked(requirePermission).mockResolvedValue(userId);
});

async function input(over: Record<string, unknown> = {}) {
  const row = await getDocumentStyle();
  return {
    ...DEFAULT_DOCUMENT_STYLE,
    expectedUpdatedAt: row.updatedAt.toISOString(),
    ...over,
  };
}

describe("saveDocumentStyle", () => {
  test("gates on firm.edit_document_style and writes nothing when denied", async () => {
    const i = await input({ fontKey: "arial" });
    vi.mocked(requirePermission).mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(saveDocumentStyle(i)).rejects.toThrow("NEXT_REDIRECT");
    expect(requirePermission).toHaveBeenCalledWith("firm.edit_document_style");
    expect((await getDocumentStyle()).fontKey).toBe("times");
  });

  test("saves, returns new updatedAt, logs at firm scope, revalidates", async () => {
    const i = await input({ fontKey: "garamond", marginTopIn: 1.25, pageNumbers: "none" });
    const r = await saveDocumentStyle(i);
    expect(r.ok).toBe(true);
    const row = await getDocumentStyle();
    expect(row.fontKey).toBe("garamond");
    expect(row.marginTopIn).toBe(1.25);
    expect(r.ok && r.updatedAt).toBe(row.updatedAt.toISOString());
    const log = await prisma.activityLog.findFirst({ where: { source: "Settings" } });
    expect(log?.matterId).toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith("/settings/documents");
    expect(revalidatePath).toHaveBeenCalledWith("/settings/templates");
  });

  test.each([
    ["margin low", { marginLeftIn: 0.49 }],
    ["margin high", { marginRightIn: 2.01 }],
    ["margin 3 decimals", { marginTopIn: 1.005 }],
    ["bad font", { fontKey: "comic" }],
    ["bad page numbers", { pageNumbers: "top" }],
    ["bad logo position", { logoPosition: "up" }],
  ])("refuses %s", async (_n, over) => {
    const before = await input();
    const r = await saveDocumentStyle({ ...before, ...over } as never);
    expect(r.ok).toBe(false);
    const row = await getDocumentStyle();
    expect(row.updatedAt.toISOString()).toBe(before.expectedUpdatedAt);
  });

  test("block ids must exist (archived allowed) or be null", async () => {
    const archived = await prisma.templateBlock.create({
      data: { key: "old", name: "Old", content: { type: "doc", content: [] }, isActive: false },
    });
    expect((await saveDocumentStyle(await input({ letterheadBlockId: "nope" }))).ok).toBe(false);
    expect((await saveDocumentStyle(await input({ continuationBlockId: "nope" }))).ok).toBe(false);
    const ok = await saveDocumentStyle(
      await input({ letterheadBlockId: archived.id, continuationBlockId: null }),
    );
    expect(ok.ok).toBe(true);
    expect((await getDocumentStyle()).letterheadBlockId).toBe(archived.id);
  });

  test("stale save is refused with the spec copy", async () => {
    const i = await input();
    expect((await saveDocumentStyle({ ...i, fontKey: "arial" })).ok).toBe(true);
    const r = await saveDocumentStyle({ ...i, fontKey: "courier" });
    expect(r).toEqual({
      ok: false,
      error: "Someone else saved the document style — reload to see their changes.",
    });
    expect((await getDocumentStyle()).fontKey).toBe("arial");
  });

  test("does not touch the logo columns", async () => {
    const row = await getDocumentStyle();
    await prisma.documentStyle.update({
      where: { id: row.id },
      data: { logoKey: "k1", logoContentType: "image/png" },
    });
    const i = await input();
    expect((await saveDocumentStyle({ ...i, logoPosition: "right" })).ok).toBe(true);
    const after = await getDocumentStyle();
    expect(after.logoKey).toBe("k1");
    expect(after.logoPosition).toBe("right");
  });
});

describe("saveDocumentStyle and Body", () => {
  test("never writes the legacy size, spacing or space-after columns", async () => {
    const i = await input({ fontSizeHalfPt: 28, lineSpacing: "double", spaceAfterPt: 3 });
    expect((await saveDocumentStyle(i)).ok).toBe(true);
    const row = await prisma.documentStyle.findFirstOrThrow({ where: { firmId } });
    expect(row.fontSizeHalfPt).toBe(24);
    expect(row.lineSpacing).toBe("single");
    expect(row.spaceAfterPt).toBe(12);
  });
});

describe("saveParagraphStyles", () => {
  const house = { fontSizeHalfPt: 24, lineSpacing: "single" as const, spaceAfterPt: 12 };
  const defaults = () => defaultParagraphStyles(house);
  const custom = (name: string, key = "caption-2"): ParagraphStyle => ({
    key,
    name,
    builtIn: false,
    values: defaults()[0].values,
  });
  const call = async (styles: ParagraphStyle[], over: Record<string, unknown> = {}) => {
    const row = await getDocumentStyle();
    return saveParagraphStyles({
      styles,
      expectedUpdatedAt: row.updatedAt.toISOString(),
      ...over,
    });
  };
  const doc = (style: string) => ({
    type: "doc",
    content: [{ type: "paragraph", attrs: { style } }],
  });

  test("gates on firm.edit_document_style and writes nothing when denied", async () => {
    vi.mocked(requirePermission).mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(call(defaults())).rejects.toThrow("NEXT_REDIRECT");
    expect(requirePermission).toHaveBeenCalledWith("firm.edit_document_style");
    const row = await prisma.documentStyle.findFirstOrThrow({ where: { firmId } });
    expect(row.paragraphStyles).toBeNull();
  });

  test("a stale timestamp is refused with the house style message", async () => {
    const stale = (await getDocumentStyle()).updatedAt.toISOString();
    expect((await call(defaults())).ok).toBe(true);
    const r = await saveParagraphStyles({ styles: defaults(), expectedUpdatedAt: stale });
    expect(r).toEqual({
      ok: false,
      error: "Someone else saved the document style — reload to see their changes.",
    });
  });

  test("removing a built-in is refused", async () => {
    const r = await call(defaults().filter((s) => s.key !== "body"));
    expect(r).toEqual({ ok: false, error: "Body can't be deleted." });
  });

  test("a malformed key is refused", async () => {
    const r = await call([...defaults(), custom("Bad", "Bad Key")]);
    expect(r.ok).toBe(false);
  });

  test("removing a custom style used by templates names them", async () => {
    expect((await call([...defaults(), custom("Caption 2")])).ok).toBe(true);
    for (const name of ["A", "B", "C"]) {
      await prisma.documentTemplate.create({ data: { name, content: doc("caption-2") } });
    }
    const r = await call(defaults());
    expect(r).toEqual({ ok: false, error: "Caption 2 is used by 3 templates: A, B, C." });
    const row = await getDocumentStyle();
    expect(row.paragraphStyles).toHaveLength(9);
  });

  test("removing a custom style used only by a block is refused", async () => {
    expect((await call([...defaults(), custom("Caption 2")])).ok).toBe(true);
    await prisma.templateBlock.create({
      data: { key: "b", name: "Sig block", content: doc("caption-2") },
    });
    const r = await call(defaults());
    expect(r).toEqual({ ok: false, error: "Caption 2 is used by 1 block: Sig block." });
  });

  test("an unused custom style can be removed", async () => {
    expect((await call([...defaults(), custom("Caption 2")])).ok).toBe(true);
    expect((await call(defaults())).ok).toBe(true);
    expect(await getDocumentStyle()).toMatchObject({ paragraphStyles: defaults() });
  });

  test("removing a custom style strips its key from every court's overrides, keeping the rest", async () => {
    expect((await call([...defaults(), custom("Caption 2")])).ok).toBe(true);
    const mk = (name: string, styleOverrides: object) =>
      prisma.courtFormat.create({ data: { name, courtSystem: "state", styleOverrides } });
    const a = await mk("A", { "caption-2": { bold: true }, body: { sizePt: 14 } });
    const b = await mk("B", { "caption-2": { italic: true } });
    const c = await mk("C", { body: { sizePt: 13 } });
    expect((await call(defaults())).ok).toBe(true);
    const rows = await prisma.courtFormat.findMany({ orderBy: { name: "asc" } });
    expect(rows.map((r) => r.styleOverrides)).toEqual([
      { body: { sizePt: 14 } },
      {},
      { body: { sizePt: 13 } },
    ]);
    expect([a.id, b.id, c.id]).toEqual(rows.map((r) => r.id));
  });

  test("a stale save leaves court overrides alone", async () => {
    expect((await call([...defaults(), custom("Caption 2")])).ok).toBe(true);
    const court = await prisma.courtFormat.create({
      data: { name: "A", courtSystem: "state", styleOverrides: { "caption-2": { bold: true } } },
    });
    const r = await call(defaults(), { expectedUpdatedAt: new Date(0).toISOString() });
    expect(r.ok).toBe(false);
    const row = await prisma.courtFormat.findUniqueOrThrow({ where: { id: court.id } });
    expect(row.styleOverrides).toEqual({ "caption-2": { bold: true } });
  });

  test("a valid save persists, syncs legacy Body columns, logs and revalidates", async () => {
    const styles = defaults();
    styles[0] = {
      ...styles[0],
      values: { ...styles[0].values, sizePt: 13, lineSpacing: "1.5", spaceAfterPt: 6 },
    };
    styles.push(custom("Caption 2"));
    const r = await call(styles);
    expect(r.ok).toBe(true);
    const row = await prisma.documentStyle.findFirstOrThrow({ where: { firmId } });
    expect(row.paragraphStyles).toEqual(styles);
    expect(row.fontSizeHalfPt).toBe(26);
    expect(row.lineSpacing).toBe("1.5");
    expect(row.spaceAfterPt).toBe(6);
    expect(r.ok && r.updatedAt).toBe(row.updatedAt.toISOString());
    expect((await getDocumentStyle()).paragraphStyles).toEqual(styles);
    const log = await prisma.activityLog.findFirst({ where: { source: "Settings" } });
    expect(log?.matterId).toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith("/settings/documents");
  });

  test("renaming a built-in persists", async () => {
    const styles = defaults();
    styles[0] = { ...styles[0], name: "Main text" };
    expect((await call(styles)).ok).toBe(true);
    const body = (await getDocumentStyle()).paragraphStyles.find((p) => p.key === "body");
    expect(body).toMatchObject({ name: "Main text", builtIn: true });
  });

  test("exact Body line spacing leaves the legacy column unchanged", async () => {
    const styles = defaults();
    styles[0] = {
      ...styles[0],
      values: { ...styles[0].values, lineSpacing: { exactPt: 18 } },
    };
    expect((await call(styles)).ok).toBe(true);
    const row = await prisma.documentStyle.findFirstOrThrow({ where: { firmId } });
    expect(row.lineSpacing).toBe("single");
  });
});
