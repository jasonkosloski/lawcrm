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

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(),
}));

import { Prisma } from "@/generated/prisma/client";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { prisma } from "@/lib/prisma";
import { getInvoiceById, getMatterBilling } from "@/lib/queries/billing";
import {
  resetDb,
  seedExpense,
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
  dueDate?: Date;
}): Promise<string> {
  const inv = await prisma.invoice.create({
    data: {
      invoiceNumber: opts.invoiceNumber,
      matterId: opts.matterId,
      kind: opts.kind ?? "client",
      issueDate: new Date("2026-06-01"),
      dueDate: opts.dueDate ?? new Date("2026-07-01"),
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

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  vi.mocked(getCurrentUserTimeZone).mockResolvedValue("America/Denver");
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
      status: "sent",
    });
    await seedInvoice({
      matterId,
      invoiceNumber: "2026-002",
      totalAmount: 100.1,
      paidAmount: 99.9,
      status: "partial",
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

describe("getMatterBilling — Outstanding AR", () => {
  test("counts only billed client invoices (sent / partial), not drafts, approved, paid, void or internal records", async () => {
    const rows: Array<[string, string, string, number, number]> = [
      ["2026-001", "client", "draft", 3000, 0],
      ["2026-002", "client", "approved", 2000, 0],
      ["2026-003", "client", "sent", 500, 0],
      ["2026-004", "client", "partial", 400, 150],
      ["2026-005", "client", "paid", 700, 700],
      ["2026-006", "client", "void", 900, 0],
      ["2026-007", "internal_record", "paid", 1200, 1200],
      ["2026-008", "internal_record", "draft", 800, 0],
    ];
    for (const [invoiceNumber, kind, status, totalAmount, paidAmount] of rows) {
      await seedInvoice({ matterId, invoiceNumber, kind, status, totalAmount, paidAmount });
    }
    const billing = await getMatterBilling(matterId);
    // 500 + (400 - 150): the same two states the AR aging report counts.
    expect(billing.outstandingAr).toBe(750);
  });

  test("a matter with only an unsent draft owes nothing", async () => {
    await seedInvoice({
      matterId,
      invoiceNumber: "2026-001",
      totalAmount: 3000,
      status: "draft",
    });
    expect((await getMatterBilling(matterId)).outstandingAr).toBe(0);
  });
});

describe("getMatterBilling — line item count", () => {
  test("counts billed expenses as well as time entries", async () => {
    const invId = await seedInvoice({
      matterId,
      invoiceNumber: "2026-001",
      totalAmount: 100,
      status: "draft",
    });
    const t = await seedTimeEntry({ matterId, userId, amount: 50 });
    await prisma.timeEntry.update({
      where: { id: t.timeEntryId },
      data: { invoiceId: invId },
    });
    const e = await seedExpense({ matterId, amount: 50 });
    await prisma.expense.update({
      where: { id: e.expenseId },
      data: { invoiceId: invId },
    });
    const billing = await getMatterBilling(matterId);
    expect(billing.invoices[0].lineItemCount).toBe(2);
  });
});

describe("daysUntilDue", () => {
  // 2026-07-02T02:00Z is still July 1 at 8 pm in Denver.
  const NOW = new Date("2026-07-02T02:00:00Z");

  test("is null for draft and approved invoices (never billed, so never 'late')", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const past = new Date("2026-05-01T12:00:00Z");
    const draft = await seedInvoice({
      matterId,
      invoiceNumber: "2026-001",
      totalAmount: 10,
      status: "draft",
      dueDate: past,
    });
    const approved = await seedInvoice({
      matterId,
      invoiceNumber: "2026-002",
      totalAmount: 10,
      status: "approved",
      dueDate: past,
    });
    const billing = await getMatterBilling(matterId);
    for (const id of [draft, approved]) {
      expect(billing.invoices.find((i) => i.id === id)!.daysUntilDue).toBeNull();
      expect((await getInvoiceById(id))!.daysUntilDue).toBeNull();
    }
  });

  test("is null for paid and void invoices", async () => {
    const past = new Date("2026-05-01T12:00:00Z");
    const paid = await seedInvoice({
      matterId,
      invoiceNumber: "2026-001",
      totalAmount: 10,
      paidAmount: 10,
      status: "paid",
      dueDate: past,
    });
    const voided = await seedInvoice({
      matterId,
      invoiceNumber: "2026-002",
      totalAmount: 10,
      status: "void",
      dueDate: past,
    });
    expect((await getInvoiceById(paid))!.daysUntilDue).toBeNull();
    expect((await getInvoiceById(voided))!.daysUntilDue).toBeNull();
  });

  test("sent / partial count whole days in the viewer's zone: due today is 0, yesterday is -1", async () => {
    // It is the evening of July 1 in Denver (already July 2 in UTC).
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const dueToday = await seedInvoice({
      matterId,
      invoiceNumber: "2026-001",
      totalAmount: 10,
      status: "sent",
      dueDate: new Date("2026-07-01T17:00:00Z"),
    });
    const dueYesterday = await seedInvoice({
      matterId,
      invoiceNumber: "2026-002",
      totalAmount: 10,
      status: "partial",
      paidAmount: 1,
      dueDate: new Date("2026-06-30T17:00:00Z"),
    });
    const dueIn5 = await seedInvoice({
      matterId,
      invoiceNumber: "2026-003",
      totalAmount: 10,
      status: "sent",
      dueDate: new Date("2026-07-06T17:00:00Z"),
    });
    const billing = await getMatterBilling(matterId);
    const days = (id: string) => billing.invoices.find((i) => i.id === id)!.daysUntilDue;
    expect(days(dueToday)).toBe(0);
    expect(days(dueYesterday)).toBe(-1);
    expect(days(dueIn5)).toBe(5);
    // The preview pane agrees with the table row.
    expect((await getInvoiceById(dueYesterday))!.daysUntilDue).toBe(-1);
  });

  test("the count does not shift across a DST change", async () => {
    // Due Mar 20 (after the Mar 8 spring-forward), viewed Mar 5.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-03-05T19:00:00Z") });
    const id = await seedInvoice({
      matterId,
      invoiceNumber: "2026-001",
      totalAmount: 10,
      status: "sent",
      dueDate: new Date("2026-03-20T19:00:00Z"),
    });
    expect((await getInvoiceById(id))!.daysUntilDue).toBe(15);
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
    expect(billing.wip.expenseCount).toBe(0);
    expect(billing.wip.expenseTotal).toBe(0);
    expect(billing.wip.recent).toHaveLength(0);
  });

  test("no-charge time never counts as WIP", async () => {
    await seedTimeEntry({ matterId, userId, hours: 1, rate: 100 });
    const noCharge = await seedTimeEntry({ matterId, userId, hours: 9, rate: 100 });
    await prisma.timeEntry.update({
      where: { id: noCharge.timeEntryId },
      data: { noCharge: true },
    });
    const billing = await getMatterBilling(matterId);
    expect(billing.wip.entryCount).toBe(1);
    expect(billing.wip.hoursTotal).toBe(1);
    expect(billing.wip.amountTotal).toBe(100);
  });

  test("billable un-invoiced expenses are their own WIP bucket (expenses-only matters can invoice)", async () => {
    await seedExpense({ matterId, amount: 1000 });
    await seedExpense({ matterId, amount: 250 });
    // Not WIP: non-billable, and already invoiced.
    await seedExpense({ matterId, amount: 999, billable: false });
    const invoiceId = await seedInvoice({ matterId, invoiceNumber: "2026-001", totalAmount: 5 });
    await seedExpense({ matterId, amount: 777, invoiceId });

    const billing = await getMatterBilling(matterId);
    expect(billing.wip.entryCount).toBe(0);
    expect(billing.wip.expenseCount).toBe(2);
    expect(billing.wip.expenseTotal).toBe(1250);
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
        date: new Date(Date.UTC(2026, 0, 1 + i)),
      })),
    });

    const billing = await getMatterBilling(matterId);
    expect(billing.receivedPayments.totalReceived).toBe(220);
    expect(billing.receivedPayments.rows).toHaveLength(20);
    // Newest first — the capped window keeps the most recent rows.
    expect(billing.receivedPayments.rows[0].date.getTime()).toBe(Date.UTC(2026, 0, 22));
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
