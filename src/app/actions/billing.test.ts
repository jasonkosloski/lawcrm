/**
 * Integration tests for the billing action layer.
 *
 * Covers `generateInvoiceFromWip` end-to-end against a real test
 * SQLite DB: seeds a matter with billable time + expenses, runs
 * the action, asserts the resulting invoice + linkage.
 *
 * Auth context (`getCurrentUserId`) is module-mocked to return a
 * fixture userId. `next/cache.revalidatePath` is a no-op stub —
 * Next's revalidate machinery isn't active outside a request.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// Mocks must come before importing the action under test.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/current-user", () => ({
  getCurrentUserId: vi.fn(),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import {
  generateInvoiceFromWip,
  setInvoiceStatus,
} from "@/app/actions/billing";
import {
  resetDb,
  seedExpense,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedTimeEntry,
  seedUser,
} from "@/test/integration-helpers";
import { billingInitialState } from "@/lib/billing-form";

const mockedGetUser = vi.mocked(getCurrentUserId);

let firmId: string;
let userId: string;
let matterId: string;

beforeAll(async () => {
  // Sanity — make sure we're pointed at the test DB and not the
  // dev one. A typo in setup or env handling could otherwise
  // wreck dev data.
  expect(process.env.DATABASE_URL).toMatch(/test\.db$/);
});

beforeEach(async () => {
  await resetDb();
  const firm = await seedFirm();
  firmId = firm.firmId;
  const user = await seedUser({ firmId });
  userId = user.userId;
  mockedGetUser.mockResolvedValue(userId);

  const area = await seedPracticeArea();
  const matter = await seedMatter({
    practiceAreaId: area.areaId,
    stageId: area.stageId,
    leadUserId: userId,
  });
  matterId = matter.matterId;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("generateInvoiceFromWip — bundling", () => {
  test("rolls billable time + expenses into one invoice with the right subtotal", async () => {
    await seedTimeEntry({
      matterId,
      userId,
      hours: 2,
      rate: 250,
      amount: 500, // 2h × $250
    });
    await seedTimeEntry({
      matterId,
      userId,
      hours: 1,
      rate: 250,
      amount: 250,
    });
    await seedExpense({ matterId, amount: 100 });
    await seedExpense({ matterId, amount: 50 });

    const fd = new FormData();
    const result = await generateInvoiceFromWip(matterId, billingInitialState, fd);
    expect(result.status).toBe("ok");

    const invoices = await prisma.invoice.findMany({
      where: { matterId },
      include: { lineItems: true, expenseLineItems: true },
    });
    expect(invoices).toHaveLength(1);
    const inv = invoices[0]!;
    // 500 + 250 + 100 + 50 = 900
    expect(inv.totalAmount.toNumber()).toBe(900);
    expect(inv.subtotal.toNumber()).toBe(900);
    expect(inv.status).toBe("draft");
    expect(inv.kind).toBe("client");
    expect(inv.lineItems).toHaveLength(2);
    expect(inv.expenseLineItems).toHaveLength(2);
  });

  test("flips linked time entries to status='billed' and stamps invoiceId", async () => {
    const { timeEntryId } = await seedTimeEntry({ matterId, userId });
    await generateInvoiceFromWip(matterId, billingInitialState, new FormData());

    const te = await prisma.timeEntry.findUnique({
      where: { id: timeEntryId },
    });
    expect(te?.status).toBe("billed");
    expect(te?.invoiceId).not.toBeNull();
  });

  test("links expenses via Expense.invoiceId", async () => {
    const { expenseId } = await seedExpense({ matterId, amount: 75 });
    await generateInvoiceFromWip(matterId, billingInitialState, new FormData());

    const ex = await prisma.expense.findUnique({ where: { id: expenseId } });
    expect(ex?.invoiceId).not.toBeNull();
  });

  test("ignores already-invoiced time entries", async () => {
    // Pre-existing invoice on the matter; this entry is already on it.
    const existingInvoice = await prisma.invoice.create({
      data: {
        invoiceNumber: "2026-999",
        matterId,
        issueDate: new Date(),
        dueDate: new Date(),
        subtotal: 500,
        totalAmount: 500,
        paidAmount: 0,
      },
      select: { id: true },
    });
    await seedTimeEntry({
      matterId,
      userId,
      amount: 500,
      status: "billed",
      invoiceId: existingInvoice.id,
    });
    // A fresh billable entry that SHOULD bundle.
    await seedTimeEntry({ matterId, userId, amount: 250 });

    await generateInvoiceFromWip(matterId, billingInitialState, new FormData());

    const newInvoice = await prisma.invoice.findFirst({
      where: { matterId, NOT: { invoiceNumber: "2026-999" } },
      include: { lineItems: true },
    });
    expect(newInvoice).not.toBeNull();
    // Only the un-invoiced entry should be on the new invoice.
    expect(newInvoice!.lineItems).toHaveLength(1);
    expect(newInvoice!.subtotal.toNumber()).toBe(250);
  });

  test("ignores non-billable + no-charge time entries", async () => {
    await seedTimeEntry({ matterId, userId, amount: 200, billable: false });
    await seedTimeEntry({ matterId, userId, amount: 100 }); // billable

    const result = await generateInvoiceFromWip(
      matterId,
      billingInitialState,
      new FormData()
    );
    expect(result.status).toBe("ok");

    const inv = await prisma.invoice.findFirst({
      where: { matterId },
      include: { lineItems: true },
    });
    expect(inv?.lineItems).toHaveLength(1);
    expect(inv?.subtotal.toNumber()).toBe(100);
  });

  test("refuses when nothing billable is on the matter", async () => {
    const result = await generateInvoiceFromWip(
      matterId,
      billingInitialState,
      new FormData()
    );
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/Nothing unbilled/i);

    const invoices = await prisma.invoice.count({ where: { matterId } });
    expect(invoices).toBe(0);
  });
});

describe("setInvoiceStatus — void unlinks both buckets", () => {
  test("void on an approved invoice unlinks time entries + expenses back to billable", async () => {
    // Generate an invoice that bundles a TimeEntry + an Expense.
    await seedTimeEntry({ matterId, userId, amount: 300 });
    await seedExpense({ matterId, amount: 50 });
    await generateInvoiceFromWip(matterId, billingInitialState, new FormData());

    const inv = await prisma.invoice.findFirst({ where: { matterId } });
    expect(inv).not.toBeNull();

    // Bypass the normal draft → approved → sent flow because
    // void from draft would route through delete; we want to
    // test that void itself unlinks. Force the row to "approved"
    // directly so void is the legal next step.
    await prisma.invoice.update({
      where: { id: inv!.id },
      data: { status: "approved" },
    });

    const res = await setInvoiceStatus(inv!.id, "void");
    expect(res.ok).toBe(true);

    const after = await prisma.invoice.findUnique({
      where: { id: inv!.id },
      include: { lineItems: true, expenseLineItems: true },
    });
    expect(after?.status).toBe("void");
    // Both buckets unlinked.
    expect(after?.lineItems).toHaveLength(0);
    expect(after?.expenseLineItems).toHaveLength(0);

    // Time entries flipped back to billable; expenses just have
    // invoiceId cleared.
    const te = await prisma.timeEntry.findFirst({ where: { matterId } });
    expect(te?.status).toBe("billable");
    expect(te?.invoiceId).toBeNull();

    const ex = await prisma.expense.findFirst({ where: { matterId } });
    expect(ex?.invoiceId).toBeNull();
  });
});
