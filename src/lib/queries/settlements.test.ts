/**
 * getMatterSettlement:
 *   - one settlement per matter is a database guarantee
 *     (`Settlement.matterId` unique, ADR-036), so the read and the
 *     upsert always target the same row.
 *   - the waterfall DTO the billing page renders. The pure math is
 *     in settlement-waterfall.test.ts; this pins the row -> DTO
 *     wiring against the real schema (percent vs explicit fee,
 *     negotiated liens, signed client net).
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

describe("getMatterSettlement — one row per matter", () => {
  test("the database refuses a second settlement for the same matter (ADR-036)", async () => {
    await prisma.settlement.create({ data: { matterId, grossAmount: 1000 } });
    await expect(
      prisma.settlement.create({ data: { matterId, grossAmount: 2000 } }),
    ).rejects.toMatchObject({ code: "P2002" });
    const result = await getMatterSettlement(matterId);
    expect(result?.grossAmount).toBe(1000);
  });

  test("returns null when the matter has no settlement", async () => {
    expect(await getMatterSettlement(matterId)).toBeNull();
  });
});

describe("getMatterSettlement — waterfall", () => {
  const seedSettlement = (
    data: {
      grossAmount?: string;
      firmFeePercent?: string | null;
      firmFee?: string;
      advancedCosts?: string;
    } = {},
  ) =>
    prisma.settlement.create({
      data: {
        matterId,
        grossAmount: data.grossAmount ?? "100000",
        firmFeePercent: data.firmFeePercent === undefined ? "33.33" : data.firmFeePercent,
        firmFee: data.firmFee ?? "0",
        advancedCosts: data.advancedCosts ?? "0",
      },
    });

  test("percent fee is recomputed on read from the percent, not the stored column", async () => {
    await seedSettlement({ firmFee: "1" });
    const s = await getMatterSettlement(matterId);
    expect(s!.firmFee).toBe(33330);
    expect(s!.clientNet).toBe(66670);
  });

  test("explicit fee is used when there is no percent", async () => {
    await seedSettlement({ firmFeePercent: null, firmFee: "27500.50" });
    const s = await getMatterSettlement(matterId);
    expect(s!.firmFee).toBe(27500.5);
    expect(s!.firmFeePercent).toBeNull();
  });

  test("a half-cent fee rounds half-up on read", async () => {
    await seedSettlement({ grossAmount: "10001.05", firmFeePercent: "50" });
    expect((await getMatterSettlement(matterId))!.firmFee).toBe(5000.53);
  });

  test("negotiated lien amounts override the original in the total and the net", async () => {
    const s = await seedSettlement({ advancedCosts: "1200" });
    await prisma.settlementLien.createMany({
      data: [
        {
          settlementId: s.id,
          lienholder: "A",
          originalAmount: "5000",
          negotiatedAmount: "2500",
        },
        { settlementId: s.id, lienholder: "B", originalAmount: "1000" },
      ],
    });
    const dto = await getMatterSettlement(matterId);
    expect(dto!.liens.map((l) => l.effectiveAmount).sort()).toEqual([1000, 2500]);
    expect(dto!.lienTotal).toBe(3500);
    // 100000 - 33330 - 1200 - 3500
    expect(dto!.clientNet).toBe(61970);
  });

  test("client net goes negative instead of clamping to zero (shortfall)", async () => {
    const s = await seedSettlement({
      grossAmount: "25000",
      firmFeePercent: "40",
      advancedCosts: "4000",
    });
    await prisma.settlementLien.create({
      data: {
        settlementId: s.id,
        lienholder: "Hospital",
        originalAmount: "15000",
      },
    });
    expect((await getMatterSettlement(matterId))!.clientNet).toBe(-4000);
  });
});
