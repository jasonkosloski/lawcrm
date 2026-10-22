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
import { saveDocumentStyle } from "@/app/actions/document-style";
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
    ["font size low", { fontSizeHalfPt: 19 }],
    ["font size high", { fontSizeHalfPt: 29 }],
    ["font size fractional", { fontSizeHalfPt: 24.5 }],
    ["space after high", { spaceAfterPt: 25 }],
    ["space after negative", { spaceAfterPt: -1 }],
    ["margin low", { marginLeftIn: 0.49 }],
    ["margin high", { marginRightIn: 2.01 }],
    ["margin 3 decimals", { marginTopIn: 1.005 }],
    ["bad font", { fontKey: "comic" }],
    ["bad spacing", { lineSpacing: "triple" }],
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
