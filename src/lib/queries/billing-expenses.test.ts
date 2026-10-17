/**
 * Integration test: the unbilled-expense summary uses the same
 * predicate the invoice-generation actions sweep (billable AND not yet
 * invoiced), per matter.
 */

import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { getUnbilledExpenseSummary } from "@/lib/queries/billing-expenses";
import {
  resetDb,
  seedExpense,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

let matterId: string;
let otherMatterId: string;

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
  ({ matterId: otherMatterId } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: userId,
  }));
});

describe("getUnbilledExpenseSummary", () => {
  test("empty matter is zero", async () => {
    expect(await getUnbilledExpenseSummary(matterId)).toEqual({
      count: 0,
      total: 0,
    });
  });

  test("counts only billable, un-invoiced expenses of this matter", async () => {
    const inv = await prisma.invoice.create({
      data: {
        invoiceNumber: "X-1",
        matterId,
        issueDate: new Date(),
        dueDate: new Date(),
        subtotal: 10,
        totalAmount: 10,
        status: "draft",
      },
      select: { id: true },
    });
    await seedExpense({ matterId, amount: 125.5 });
    await seedExpense({ matterId, amount: 74.5 });
    await seedExpense({ matterId, amount: 999, billable: false });
    await seedExpense({ matterId, amount: 888, invoiceId: inv.id });
    await seedExpense({ matterId: otherMatterId, amount: 777 });

    expect(await getUnbilledExpenseSummary(matterId)).toEqual({
      count: 2,
      total: 200,
    });
  });
});
