/**
 * Integration test for the DocumentStyle schema: per-firm house style
 * defaults, one row per firm, and SetNull on the referenced blocks.
 * (The seeded continuation block and permission grant come from the
 * migration SQL, verified against a migrated scratch DB.)
 */

import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "@/test/integration-helpers";

beforeEach(async () => {
  await resetDb();
});

async function makeFirm() {
  return prisma.firm.create({ data: { name: "Test Firm" } });
}

describe("document style schema", () => {
  test("a style with only firmId gets every default", async () => {
    const firm = await makeFirm();
    const s = await prisma.documentStyle.create({ data: { firmId: firm.id } });
    expect(s.fontKey).toBe("times");
    expect(s.fontSizeHalfPt).toBe(24);
    expect(s.lineSpacing).toBe("single");
    expect(s.spaceAfterPt).toBe(12);
    for (const m of [s.marginTopIn, s.marginRightIn, s.marginBottomIn, s.marginLeftIn]) {
      expect(m.toString()).toBe("1");
    }
    expect(s.letterheadBlockId).toBeNull();
    expect(s.logoPosition).toBe("none");
    expect(s.logoKey).toBeNull();
    expect(s.logoContentType).toBeNull();
    expect(s.continuationBlockId).toBeNull();
    expect(s.pageNumbers).toBe("bottom_center");
  });

  test("only one style per firm", async () => {
    const firm = await makeFirm();
    await prisma.documentStyle.create({ data: { firmId: firm.id } });
    await expect(prisma.documentStyle.create({ data: { firmId: firm.id } })).rejects.toMatchObject({
      code: "P2002",
    });
  });

  test("deleting a referenced block nulls the style's block ids", async () => {
    const firm = await makeFirm();
    const content = { type: "doc", content: [] };
    const lh = await prisma.templateBlock.create({
      data: { key: "lh-test", name: "LH", content },
    });
    const co = await prisma.templateBlock.create({
      data: { key: "co-test", name: "CO", content },
    });
    const s = await prisma.documentStyle.create({
      data: {
        firmId: firm.id,
        letterheadBlockId: lh.id,
        continuationBlockId: co.id,
      },
    });
    await prisma.templateBlock.delete({ where: { id: lh.id } });
    await prisma.templateBlock.delete({ where: { id: co.id } });
    const after = await prisma.documentStyle.findUniqueOrThrow({
      where: { id: s.id },
    });
    expect(after.letterheadBlockId).toBeNull();
    expect(after.continuationBlockId).toBeNull();
  });
});
