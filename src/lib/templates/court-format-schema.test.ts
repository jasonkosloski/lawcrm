/**
 * Integration test for the CourtFormat schema: defaults, unique name,
 * one replacement per source block, cascade from the format, Restrict on
 * the blocks, and SetNull on Venue.courtFormatId. (The permission grant
 * comes from the migration SQL, verified against a migrated scratch DB.)
 */

import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "@/test/integration-helpers";

beforeEach(async () => {
  await resetDb();
});

const content = { type: "doc", content: [] };

async function makeBlock(key: string) {
  return prisma.templateBlock.create({ data: { key, name: key, content } });
}

describe("court format schema", () => {
  test("a format with only a name gets every default", async () => {
    const f = await prisma.courtFormat.create({ data: { name: "Superior Court" } });
    expect(f.courtSystem).toBe("state");
    expect(f.paperSize).toBe("letter");
    expect(f.isActive).toBe(true);
    expect(f.fontKey).toBeNull();
    expect(f.fontSizeHalfPt).toBeNull();
    expect(f.lineSpacing).toBeNull();
    expect(f.spaceAfterPt).toBeNull();
    expect(f.marginTopIn).toBeNull();
    expect(f.marginRightIn).toBeNull();
    expect(f.marginBottomIn).toBeNull();
    expect(f.marginLeftIn).toBeNull();
    expect(f.pageNumbers).toBeNull();
  });

  test("format names are unique", async () => {
    await prisma.courtFormat.create({ data: { name: "Dup" } });
    await expect(prisma.courtFormat.create({ data: { name: "Dup" } })).rejects.toMatchObject({
      code: "P2002",
    });
  });

  test("a block can be replaced only once per format", async () => {
    const f = await prisma.courtFormat.create({ data: { name: "F" } });
    const a = await makeBlock("a");
    const b = await makeBlock("b");
    const c = await makeBlock("c");
    await prisma.courtFormatBlock.create({
      data: { courtFormatId: f.id, blockId: a.id, replacementBlockId: b.id },
    });
    await expect(
      prisma.courtFormatBlock.create({
        data: { courtFormatId: f.id, blockId: a.id, replacementBlockId: c.id },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  test("deleting the format cascades its replacement rows", async () => {
    const f = await prisma.courtFormat.create({ data: { name: "F" } });
    const a = await makeBlock("a");
    const b = await makeBlock("b");
    await prisma.courtFormatBlock.create({
      data: { courtFormatId: f.id, blockId: a.id, replacementBlockId: b.id },
    });
    await prisma.courtFormat.delete({ where: { id: f.id } });
    expect(await prisma.courtFormatBlock.count()).toBe(0);
    expect(await prisma.templateBlock.count()).toBe(2);
  });

  test("deleting a referenced block (either side) is refused", async () => {
    const f = await prisma.courtFormat.create({ data: { name: "F" } });
    const a = await makeBlock("a");
    const b = await makeBlock("b");
    await prisma.courtFormatBlock.create({
      data: { courtFormatId: f.id, blockId: a.id, replacementBlockId: b.id },
    });
    await expect(prisma.templateBlock.delete({ where: { id: a.id } })).rejects.toMatchObject({
      code: "P2003",
    });
    await expect(prisma.templateBlock.delete({ where: { id: b.id } })).rejects.toMatchObject({
      code: "P2003",
    });
  });

  test("deleting a format nulls Venue.courtFormatId; captionName defaults null", async () => {
    const f = await prisma.courtFormat.create({ data: { name: "F" } });
    const v = await prisma.venue.create({
      data: { name: "V", nameKey: "v", state: "CA", courtFormatId: f.id },
    });
    expect(v.captionName).toBeNull();
    await prisma.courtFormat.delete({ where: { id: f.id } });
    const after = await prisma.venue.findUniqueOrThrow({ where: { id: v.id } });
    expect(after.courtFormatId).toBeNull();
  });
});
