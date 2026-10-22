import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/scope-access", () => ({ assertScopeAccess: vi.fn() }));

import { assertScopeAccess } from "@/lib/scope-access";
import { prisma } from "@/lib/prisma";
import { loadCourtContext } from "./court-context";
import {
  resetDb,
  seedPracticeArea,
  seedUser,
  seedFirm,
  seedMatter,
} from "@/test/integration-helpers";

let matterId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  vi.mocked(assertScopeAccess).mockResolvedValue("u");
  const { firmId } = await seedFirm();
  const { userId } = await seedUser({ firmId });
  const { areaId, stageId } = await seedPracticeArea({ name: "Civil" });
  ({ matterId } = await seedMatter({ practiceAreaId: areaId, stageId, leadUserId: userId }));
});

const content = { type: "doc", content: [] };

describe("loadCourtContext", () => {
  test("lead scope returns null after the access check", async () => {
    expect(await loadCourtContext({ kind: "lead", leadId: "l1" })).toBeNull();
    expect(assertScopeAccess).toHaveBeenCalledWith({ kind: "lead", leadId: "l1" });
  });

  test("matter without a venue returns null", async () => {
    expect(await loadCourtContext({ kind: "matter", matterId })).toBeNull();
  });

  test("venue without a format returns null", async () => {
    const v = await prisma.venue.create({ data: { name: "V", nameKey: "v", state: "CO" } });
    await prisma.matter.update({ where: { id: matterId }, data: { venueId: v.id } });
    expect(await loadCourtContext({ kind: "matter", matterId })).toBeNull();
  });

  test("venue with a format returns values and replacements", async () => {
    const a = await prisma.templateBlock.create({ data: { key: "a", name: "A", content } });
    const b = await prisma.templateBlock.create({ data: { key: "b", name: "B", content } });
    const f = await prisma.courtFormat.create({
      data: {
        name: "CO",
        fontSizeHalfPt: 26,
        marginTopIn: "1.25",
        paperSize: "legal",
        blocks: { create: { blockId: a.id, replacementBlockId: b.id } },
      },
    });
    const v = await prisma.venue.create({
      data: { name: "V", nameKey: "v", state: "CO", courtFormatId: f.id },
    });
    await prisma.matter.update({ where: { id: matterId }, data: { venueId: v.id } });
    const c = await loadCourtContext({ kind: "matter", matterId });
    expect(c).toMatchObject({ id: f.id, name: "CO", isActive: true });
    expect(c?.values.fontSizeHalfPt).toBe(26);
    expect(c?.values.marginTopIn).toBe(1.25);
    expect(c?.values.marginLeftIn).toBeNull();
    expect(c?.values.paperSize).toBe("legal");
    expect(c?.replacements.get(a.id)).toMatchObject({ id: b.id, name: "B", isActive: true });
  });

  test("a refused access check propagates", async () => {
    vi.mocked(assertScopeAccess).mockRejectedValue(new Error("NOT_FOUND"));
    await expect(loadCourtContext({ kind: "matter", matterId })).rejects.toThrow("NOT_FOUND");
  });
});
