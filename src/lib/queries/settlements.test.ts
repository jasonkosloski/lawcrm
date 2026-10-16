/**
 * getMatterSettlement must resolve to the same row upsertSettlement
 * mutates: the OLDEST settlement on the matter (F364). Otherwise, with
 * pre-existing duplicates, the composer shows one row and Save edits
 * another.
 */

import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { getMatterSettlement } from "@/lib/queries/settlements";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

let matterId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  const { userId } = await seedUser({ firmId });
  const { areaId, stageId } = await seedPracticeArea();
  ({ matterId } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: userId,
  }));
});

describe("getMatterSettlement — deterministic row", () => {
  test("returns the oldest settlement when duplicates exist", async () => {
    const older = await prisma.settlement.create({
      data: {
        matterId,
        grossAmount: 1000,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
      select: { id: true },
    });
    await prisma.settlement.create({
      data: {
        matterId,
        grossAmount: 2000,
        createdAt: new Date("2026-02-01T00:00:00Z"),
      },
    });
    const result = await getMatterSettlement(matterId);
    expect(result?.id).toBe(older.id);
    expect(result?.grossAmount).toBe(1000);
  });

  test("returns null when the matter has no settlement", async () => {
    expect(await getMatterSettlement(matterId)).toBeNull();
  });
});
