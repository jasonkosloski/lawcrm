/**
 * Integration tests for the matter Billing tab queries.
 *
 * Pins two behaviors that regressed-by-construction risks live in:
 *
 *   1. Cent rounding — derived balances (invoice `balance`,
 *      `outstandingAr`) must be exact at cent precision. The
 *      payment dialogs gate submission on `parsedAmount > balance`
 *      against a `toFixed(2)` default, so IEEE-754 dust
 *      (0.3 - 0.1 = 0.19999999999999998) falsely blocks a
 *      legitimate "pay in full".
 *
 *   2. Aggregate-vs-list split — WIP totals / entryCount and the
 *      lifetime received-payments total must cover EVERY eligible
 *      row while the visible lists stay capped (10 WIP / 20
 *      payments).
 */

import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getInvoiceById, getMatterBilling } from "@/lib/queries/billing";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedTimeEntry,
  seedUser,
} from "@/test/integration-helpers";

let matterId: string;
let userId: string;

async function seedInvoice(opts: {
  matterId: string;
  invoiceNumber: string;
  totalAmount: number;
  paidAmount?: number;
  status?: string;
  kind?: string;
}): Promise<string> {
  const inv = await prisma.invoice.create({
    data: {
      invoiceNumber: opts.invoiceNumber,
      matterId: opts.matterId,
      kind: opts.kind ?? "client",
      issueDate: new Date("2026-06-01"),
      dueDate: new Date("2026-07-01"),
      subtotal: new Prisma.Decimal(opts.totalAmount),
      totalAmount: new Prisma.Decimal(opts.totalAmount),
      paidAmount: new Prisma.Decimal(opts.paidAmount ?? 0),
      status: opts.status ?? "open",
    },
    select: { id: true },
  });
  return inv.id;
}

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  ({ userId } = await seedUser({ firmId }));
  const { areaId, stageId } = await seedPracticeArea();
  ({ matterId } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: userId,
  }));
});

describe("getMatterBilling — cent rounding", () => {
  test("invoice balance is exact at cent precision (no IEEE-754 dust)", async () => {
    // 0.3 - 0.1 in doubles is 0.19999999999999998 — the classic
    // reproducer. The query layer must hand back exactly 0.2.
    await seedInvoice({
      matterId,
      invoiceNumber: "2026-001",
      totalAmount: 0.3,
      paidAmount: 0.1,
    });

    const billing = await getMatterBilling(matterId);
    expect(billing.invoices).toHaveLength(1);
    expect(billing.invoices[0].balance).toBe(0.2);
  });

  test("outstandingAr sums balances without accumulating float error", async () => {
    await seedInvoice({
      matterId,
      invoiceNumber: "2026-001",
      totalAmount: 0.3,
      paidAmount: 0.1,
    });
    await seedInvoice({
      matterId,
      invoiceNumber: "2026-002",
      totalAmount: 100.1,
      paidAmount: 99.9,
    });

    const billing = await getMatterBilling(matterId);
    expect(billing.outstandingAr).toBe(0.4);
  });

  test("balance never goes negative on over-paid invoices", async () => {
    await seedInvoice({
      matterId,
      invoiceNumber: "2026-001",
      totalAmount: 100,
      paidAmount: 150,
      status: "paid",
    });

    const billing = await getMatterBilling(matterId);
    expect(billing.invoices[0].balance).toBe(0);
  });
});

describe("getInvoiceById — cent rounding", () => {
  test("preview balance matches the rounded row balance", async () => {
    const invoiceId = await seedInvoice({
      matterId,
      invoiceNumber: "2026-001",
      totalAmount: 0.3,
      paidAmount: 0.1,
    });

    const detail = await getInvoiceById(invoiceId);
    expect(detail?.balance).toBe(0.2);
  });
});

describe("getMatterBilling — WIP aggregate + capped recent list", () => {
  test("totals cover every eligible entry while recent caps at 10", async () => {
    // 12 eligible WIP entries — 2 more than the display limit.
    for (let i = 0; i < 12; i++) {
      await seedTimeEntry({ matterId, userId, hours: 1, rate: 250 });
    }
    // Non-eligible rows must not leak into the totals.
    await seedTimeEntry({ matterId, userId, hours: 5, billable: false });
    await seedTimeEntry({ matterId, userId, hours: 5, status: "written_off" });

    const billing = await getMatterBilling(matterId);
    expect(billing.wip.entryCount).toBe(12);
    expect(billing.wip.hoursTotal).toBe(12);
    expect(billing.wip.amountTotal).toBe(12 * 250);
    expect(billing.wip.recent).toHaveLength(10);
  });

  test("empty WIP yields zeroed totals, not nulls", async () => {
    const billing = await getMatterBilling(matterId);
    expect(billing.wip.entryCount).toBe(0);
    expect(billing.wip.hoursTotal).toBe(0);
    expect(billing.wip.amountTotal).toBe(0);
    expect(billing.wip.recent).toHaveLength(0);
  });
});

describe("getMatterBilling — received payments aggregate + capped rows", () => {
  test("lifetime total sums every payment while rows cap at 20", async () => {
    const invoiceId = await seedInvoice({
      matterId,
      invoiceNumber: "2026-001",
      totalAmount: 1000,
    });
    // 22 payments — 2 past the display limit.
    await prisma.invoicePayment.createMany({
      data: Array.from({ length: 22 }, (_, i) => ({
        invoiceId,
        source: "check",
        amount: new Prisma.Decimal(10),
        date: new Date(2026, 0, 1 + i),
      })),
    });

    const billing = await getMatterBilling(matterId);
    expect(billing.receivedPayments.totalReceived).toBe(220);
    expect(billing.receivedPayments.rows).toHaveLength(20);
    // Newest first — the capped window keeps the most recent rows.
    expect(billing.receivedPayments.rows[0].date.getTime()).toBe(
      new Date(2026, 0, 22).getTime()
    );
  });

  test("payments on other matters are excluded", async () => {
    const { areaId, stageId } = await seedPracticeArea({ name: "Other Area" });
    const { matterId: otherMatterId } = await seedMatter({
      practiceAreaId: areaId,
      stageId,
      leadUserId: userId,
      name: "Other Matter",
    });
    const otherInvoiceId = await seedInvoice({
      matterId: otherMatterId,
      invoiceNumber: "2026-099",
      totalAmount: 500,
    });
    await prisma.invoicePayment.create({
      data: {
        invoiceId: otherInvoiceId,
        source: "cash",
        amount: new Prisma.Decimal(500),
        date: new Date("2026-06-15"),
      },
    });

    const billing = await getMatterBilling(matterId);
    expect(billing.receivedPayments.totalReceived).toBe(0);
    expect(billing.receivedPayments.rows).toHaveLength(0);
  });
});
