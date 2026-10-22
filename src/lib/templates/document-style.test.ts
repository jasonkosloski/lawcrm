import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/firm", () => ({ getCurrentFirm: vi.fn() }));
vi.mock("@/lib/file-storage", () => ({ readStoredFile: vi.fn() }));

import { getCurrentFirm } from "@/lib/firm";
import { readStoredFile } from "@/lib/file-storage";
import { prisma } from "@/lib/prisma";
import { resetDb } from "@/test/integration-helpers";
import { getDocumentStyle, loadLogo } from "./document-style";
import { defaultParagraphStyles } from "./paragraph-styles";

let firmId: string;
beforeEach(async () => {
  await resetDb();
  firmId = (await prisma.firm.create({ data: { name: "F" } })).id;
  vi.mocked(getCurrentFirm).mockResolvedValue({ id: firmId } as never);
  vi.mocked(readStoredFile).mockReset();
});

async function seedBlocks() {
  for (const [id, key] of [
    ["tplblock_letterhead", "letterhead"],
    ["tplblock_continuation", "continuation"],
  ]) {
    await prisma.templateBlock.create({
      data: { id, key, name: key, content: { type: "doc", content: [] } },
    });
  }
}

describe("getDocumentStyle", () => {
  test("creates defaults once under concurrent first reads", async () => {
    const [a, b] = await Promise.all([getDocumentStyle(), getDocumentStyle()]);
    expect(a.id).toBe(b.id);
    expect(await prisma.documentStyle.count({ where: { firmId } })).toBe(1);
    expect(a.fontKey).toBe("times");
    expect(a.marginTopIn).toBe(1);
    expect(typeof a.marginLeftIn).toBe("number");
    expect(a.letterheadBlockId).toBeNull();
  });

  test("defaults letterhead/continuation to the seeded blocks when they exist", async () => {
    await seedBlocks();
    const s = await getDocumentStyle();
    expect(s.letterheadBlockId).toBe("tplblock_letterhead");
    expect(s.continuationBlockId).toBe("tplblock_continuation");
  });

  test("does not overwrite an existing row", async () => {
    await prisma.documentStyle.create({ data: { firmId, fontKey: "arial" } });
    expect((await getDocumentStyle()).fontKey).toBe("arial");
  });
});

describe("getDocumentStyle paragraphStyles", () => {
  const body = (list: { key: string; values: unknown }[]) => list.find((p) => p.key === "body");

  test("null column returns defaults derived from the row's house values", async () => {
    await prisma.documentStyle.create({
      data: { firmId, fontSizeHalfPt: 26, lineSpacing: "double", spaceAfterPt: 6 },
    });
    const s = await getDocumentStyle();
    const house = { fontSizeHalfPt: 26, lineSpacing: "double" as const, spaceAfterPt: 6 };
    expect(s.paragraphStyles).toEqual(defaultParagraphStyles(house));
  });

  test("a stored list is returned as saved; Body is not overlaid from the legacy columns", async () => {
    const stored = defaultParagraphStyles({
      fontSizeHalfPt: 24,
      lineSpacing: "single",
      spaceAfterPt: 12,
    });
    stored[1].values.bold = false; // title
    await prisma.documentStyle.create({
      data: {
        firmId,
        fontSizeHalfPt: 28,
        lineSpacing: "1.5",
        spaceAfterPt: 3,
        paragraphStyles: stored as never,
      },
    });
    const s = await getDocumentStyle();
    expect(body(s.paragraphStyles)?.values).toMatchObject({
      sizePt: 12,
      lineSpacing: "single",
      spaceAfterPt: 12,
    });
    expect(s.paragraphStyles.find((p) => p.key === "title")?.values.bold).toBe(false);
  });

  test("an invalid stored value falls back to defaults", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await prisma.documentStyle.create({ data: { firmId, paragraphStyles: { nope: 1 } } });
    const s = await getDocumentStyle();
    expect(s.paragraphStyles).toHaveLength(8);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("getDocumentStyle with a NULL column", () => {
  test("Body follows the legacy house values, so output is unchanged for untouched firms", async () => {
    await prisma.documentStyle.create({
      data: { firmId, fontSizeHalfPt: 28, lineSpacing: "1.5", spaceAfterPt: 3 },
    });
    const body = (await getDocumentStyle()).paragraphStyles.find((p) => p.key === "body");
    expect(body?.values).toMatchObject({ sizePt: 14, lineSpacing: "1.5", spaceAfterPt: 3 });
  });
});

describe("loadLogo", () => {
  const base = async () => ({
    ...(await getDocumentStyle()),
    logoKey: "k",
    logoContentType: "image/png",
    logoPosition: "left" as const,
  });

  test("position none skips storage", async () => {
    const s = { ...(await base()), logoPosition: "none" as const };
    expect(await loadLogo(s)).toEqual({ logo: null, warning: null });
    expect(readStoredFile).not.toHaveBeenCalled();
  });

  test("no logo key is not a warning", async () => {
    const s = { ...(await base()), logoKey: null, logoContentType: null };
    expect(await loadLogo(s)).toEqual({ logo: null, warning: null });
  });

  test("returns bytes, type and position", async () => {
    vi.mocked(readStoredFile).mockResolvedValue(Buffer.from([1, 2, 3]));
    const r = await loadLogo(await base());
    expect(r.warning).toBeNull();
    expect(r.logo?.position).toBe("left");
    expect(r.logo?.contentType).toBe("image/png");
    expect(Array.from(r.logo!.bytes)).toEqual([1, 2, 3]);
    expect(readStoredFile).toHaveBeenCalledWith("k", 1024 * 1024 + 1);
  });

  test.each([
    ["throws", () => Promise.reject(new Error("x"))],
    ["is missing", () => Promise.resolve(null)],
    ["is oversize", () => Promise.resolve(Buffer.alloc(1024 * 1024 + 1))],
  ])("storage that %s gives the warning", async (_n, impl) => {
    vi.mocked(readStoredFile).mockImplementation(impl as never);
    expect(await loadLogo(await base())).toEqual({
      logo: null,
      warning: "Logo couldn't be loaded.",
    });
  });
});
