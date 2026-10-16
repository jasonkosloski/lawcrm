/**
 * Integration tests for the billing action layer.
 *
 * Runs end-to-end against the real test Postgres (`:5433`): seeds a
 * matter with billable time + expenses, runs the actions, asserts
 * the resulting invoices + linkage. Postgres matters here — the
 * concurrency tests below pin `FOR UPDATE` row-lock behavior and
 * the transaction-abort-on-failed-INSERT retry semantics.
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
vi.mock("@/lib/permission-check", () => ({
  // Action-logic tests assume the user passes the gate. The gate
  // check itself is tested separately in the "RBAC gate" describe
  // block at the end of this file.
  requirePermission: vi.fn().mockResolvedValue("test-user"),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { requirePermission } from "@/lib/permission-check";
import { prisma } from "@/lib/prisma";
import {
  addTrustTransaction,
  approveInvoice,
  bundleAsInternalRecord,
  deleteInvoice,
  generateInvoiceFromWip,
  recordInvoicePayment,
  sendInvoice,
  setInvoiceStatus,
  updateInvoiceLineItem,
} from "@/app/actions/billing";
import { Prisma } from "@/generated/prisma/client";
import { lineItemEditInitialState } from "@/lib/billing-form";
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
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
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

// ── updateInvoiceLineItem ───────────────────────────────────────────────

const buildLineItemForm = (overrides: Partial<Record<string, string>> = {}) => {
  const fd = new FormData();
  fd.set("date", overrides.date ?? "2026-04-15");
  fd.set("activity", overrides.activity ?? "Updated activity");
  fd.set("narrative", overrides.narrative ?? "");
  fd.set("hours", overrides.hours ?? "1.5");
  if (overrides.rate !== undefined) {
    fd.set("rate", overrides.rate);
  } else {
    fd.set("rate", "300");
  }
  return fd;
};

describe("updateInvoiceLineItem — happy path", () => {
  test("edits date, activity, hours, rate; recomputes invoice subtotal", async () => {
    const { timeEntryId } = await seedTimeEntry({
      matterId,
      userId,
      hours: 2,
      rate: 250,
      amount: 500,
    });
    await generateInvoiceFromWip(
      matterId,
      billingInitialState,
      new FormData()
    );
    const inv = await prisma.invoice.findFirstOrThrow({ where: { matterId } });
    expect(inv.subtotal.toNumber()).toBe(500);

    const res = await updateInvoiceLineItem(
      timeEntryId,
      lineItemEditInitialState,
      buildLineItemForm({
        date: "2026-04-20",
        activity: "Renamed activity",
        narrative: "More detail",
        hours: "3",
        rate: "300",
      })
    );
    expect(res.status).toBe("ok");

    const te = await prisma.timeEntry.findUnique({
      where: { id: timeEntryId },
    });
    expect(te!.activity).toBe("Renamed activity");
    expect(te!.narrative).toBe("More detail");
    expect(te!.hours).toBe(3);
    expect(te!.rate?.toNumber()).toBe(300);
    expect(te!.amount?.toNumber()).toBe(900); // 3 × 300
    expect(te!.date.toISOString().slice(0, 10)).toBe("2026-04-20");

    // Invoice subtotal recomputed.
    const after = await prisma.invoice.findUnique({ where: { id: inv.id } });
    expect(after!.subtotal.toNumber()).toBe(900);
    expect(after!.totalAmount.toNumber()).toBe(900);
  });

  test("recomputes subtotal across all line items + expenses", async () => {
    const { timeEntryId: t1 } = await seedTimeEntry({
      matterId,
      userId,
      hours: 1,
      rate: 100,
      amount: 100,
    });
    await seedTimeEntry({
      matterId,
      userId,
      hours: 1,
      rate: 200,
      amount: 200,
    });
    await seedExpense({ matterId, amount: 50 });
    await generateInvoiceFromWip(
      matterId,
      billingInitialState,
      new FormData()
    );
    const inv = await prisma.invoice.findFirstOrThrow({ where: { matterId } });
    // 100 + 200 + 50 = 350
    expect(inv.subtotal.toNumber()).toBe(350);

    // Bump the first entry from 100 → 400.
    await updateInvoiceLineItem(
      t1,
      lineItemEditInitialState,
      buildLineItemForm({ hours: "4", rate: "100" })
    );

    const after = await prisma.invoice.findUnique({ where: { id: inv.id } });
    // 400 + 200 + 50 = 650
    expect(after!.subtotal.toNumber()).toBe(650);
    expect(after!.totalAmount.toNumber()).toBe(650);
  });

  test("empty rate clears amount (contingent-style entry)", async () => {
    const { timeEntryId } = await seedTimeEntry({
      matterId,
      userId,
      hours: 2,
      rate: 250,
      amount: 500,
    });
    await generateInvoiceFromWip(
      matterId,
      billingInitialState,
      new FormData()
    );

    const res = await updateInvoiceLineItem(
      timeEntryId,
      lineItemEditInitialState,
      buildLineItemForm({ hours: "2", rate: "" })
    );
    expect(res.status).toBe("ok");

    const te = await prisma.timeEntry.findUnique({
      where: { id: timeEntryId },
    });
    expect(te!.rate).toBeNull();
    expect(te!.amount).toBeNull();
  });
});

describe("updateInvoiceLineItem — guards", () => {
  test("rejects when the entry doesn't exist", async () => {
    const res = await updateInvoiceLineItem(
      "no-such-id",
      lineItemEditInitialState,
      buildLineItemForm()
    );
    expect(res.status).toBe("error");
    expect(res.error).toMatch(/not found/i);
  });

  test("rejects when the entry isn't on an invoice", async () => {
    // Free-floating WIP entry — no invoice yet.
    const { timeEntryId } = await seedTimeEntry({ matterId, userId });
    const res = await updateInvoiceLineItem(
      timeEntryId,
      lineItemEditInitialState,
      buildLineItemForm()
    );
    expect(res.status).toBe("error");
    expect(res.error).toMatch(/isn't on an invoice/i);
  });

  test.each(["approved", "sent", "partial", "paid", "void"])(
    "rejects when invoice status is %s",
    async (status) => {
      const { timeEntryId } = await seedTimeEntry({
        matterId,
        userId,
        amount: 500,
      });
      await generateInvoiceFromWip(
        matterId,
        billingInitialState,
        new FormData()
      );
      const inv = await prisma.invoice.findFirstOrThrow({ where: { matterId } });
      await prisma.invoice.update({
        where: { id: inv.id },
        data: { status },
      });

      const res = await updateInvoiceLineItem(
        timeEntryId,
        lineItemEditInitialState,
        buildLineItemForm()
      );
      expect(res.status).toBe("error");
      expect(res.error).toMatch(new RegExp(status, "i"));
    }
  );

  test("allows edits on a draft invoice but refuses once it is approved", async () => {
    const { timeEntryId } = await seedTimeEntry({
      matterId,
      userId,
      amount: 500,
    });
    await generateInvoiceFromWip(
      matterId,
      billingInitialState,
      new FormData()
    );
    const inv = await prisma.invoice.findFirstOrThrow({ where: { matterId } });
    expect(inv.status).toBe("draft");

    const draftRes = await updateInvoiceLineItem(
      timeEntryId,
      lineItemEditInitialState,
      buildLineItemForm()
    );
    expect(draftRes.status).toBe("ok");

    await prisma.invoice.update({
      where: { id: inv.id },
      data: { status: "approved" },
    });
    // Approval signs off on a specific total: an in-place edit after
    // that would silently change it (F019/F157). This test used to pin
    // "approved edits are fine".
    const approvedRes = await updateInvoiceLineItem(
      timeEntryId,
      lineItemEditInitialState,
      buildLineItemForm({ activity: "Approved-state edit", hours: "9" })
    );
    expect(approvedRes.status).toBe("error");
    expect(approvedRes.error).toMatch(/approved/i);
    const te = await prisma.timeEntry.findUniqueOrThrow({
      where: { id: timeEntryId },
    });
    expect(te.activity).not.toBe("Approved-state edit");
  });

  test("rejects empty activity / 0 hours / out-of-range hours", async () => {
    const { timeEntryId } = await seedTimeEntry({
      matterId,
      userId,
      amount: 500,
    });
    await generateInvoiceFromWip(
      matterId,
      billingInitialState,
      new FormData()
    );

    const empty = await updateInvoiceLineItem(
      timeEntryId,
      lineItemEditInitialState,
      buildLineItemForm({ activity: "   " })
    );
    expect(empty.status).toBe("error");
    expect(empty.errors?.activity?.length).toBeGreaterThan(0);

    const zero = await updateInvoiceLineItem(
      timeEntryId,
      lineItemEditInitialState,
      buildLineItemForm({ hours: "0" })
    );
    expect(zero.status).toBe("error");
    expect(zero.errors?.hours?.length).toBeGreaterThan(0);

    const huge = await updateInvoiceLineItem(
      timeEntryId,
      lineItemEditInitialState,
      buildLineItemForm({ hours: "30" })
    );
    expect(huge.status).toBe("error");
  });
});

describe("updateInvoiceLineItem — RBAC", () => {
  const mockedRequirePermission = vi.mocked(requirePermission);

  test("author DOES NOT need time_entries.edit_any", async () => {
    mockedRequirePermission.mockClear();
    const { timeEntryId } = await seedTimeEntry({
      matterId,
      userId, // author = current actor
      amount: 500,
    });
    await generateInvoiceFromWip(
      matterId,
      billingInitialState,
      new FormData()
    );
    await updateInvoiceLineItem(
      timeEntryId,
      lineItemEditInitialState,
      buildLineItemForm()
    );
    expect(mockedRequirePermission).not.toHaveBeenCalledWith(
      "time_entries.edit_any"
    );
  });

  test("non-author requires time_entries.edit_any", async () => {
    mockedRequirePermission.mockClear();
    // Create an entry logged by a DIFFERENT user.
    const otherUser = await seedUser({ firmId, email: "other@example.com" });
    const entry = await prisma.timeEntry.create({
      data: {
        matterId,
        userId: otherUser.userId,
        date: new Date(),
        hours: 1,
        activity: "Logged by other",
        rate: new (await import("@/generated/prisma/client")).Prisma.Decimal(
          250
        ),
        amount: new (await import("@/generated/prisma/client")).Prisma.Decimal(
          250
        ),
        billable: true,
        status: "billable",
      },
      select: { id: true },
    });
    await generateInvoiceFromWip(
      matterId,
      billingInitialState,
      new FormData()
    );

    await updateInvoiceLineItem(
      entry.id,
      lineItemEditInitialState,
      buildLineItemForm()
    );
    expect(mockedRequirePermission).toHaveBeenCalledWith(
      "time_entries.edit_any"
    );
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

describe("updateInvoiceLineItem — rate validation", () => {
  test("rejects a negative rate (client min='0' isn't enforced on the cell-edit path)", async () => {
    const { timeEntryId } = await seedTimeEntry({
      matterId,
      userId,
      hours: 2,
      rate: 250,
      amount: 500,
    });
    await generateInvoiceFromWip(matterId, billingInitialState, new FormData());

    const res = await updateInvoiceLineItem(
      timeEntryId,
      lineItemEditInitialState,
      buildLineItemForm({ rate: "-250" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.rate?.length).toBeGreaterThan(0);

    // The entry and the invoice subtotal are untouched.
    const te = await prisma.timeEntry.findUnique({ where: { id: timeEntryId } });
    expect(te!.rate?.toNumber()).toBe(250);
    expect(te!.amount?.toNumber()).toBe(500);
  });

  test("rejects a zero rate", async () => {
    const { timeEntryId } = await seedTimeEntry({
      matterId,
      userId,
      amount: 500,
    });
    await generateInvoiceFromWip(matterId, billingInitialState, new FormData());

    const res = await updateInvoiceLineItem(
      timeEntryId,
      lineItemEditInitialState,
      buildLineItemForm({ rate: "0" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.rate?.length).toBeGreaterThan(0);
  });
});

// ── setInvoiceStatus — client paid/partial funnel ───────────────────────
//
// Client invoices must reach paid/partial ONLY through
// recordInvoicePayment so every status flip is paired with a real
// InvoicePayment row. setInvoiceStatus refuses the shortcut; the
// internal-record "Mark recorded" flip (which has no AR) still works.

describe("setInvoiceStatus — client paid/partial funnel", () => {
  test.each(["paid", "partial"])(
    "refuses sent → %s on a client invoice and leaves the row untouched",
    async (next) => {
      await seedTimeEntry({ matterId, userId, amount: 500 });
      await generateInvoiceFromWip(matterId, billingInitialState, new FormData());
      const inv = await prisma.invoice.findFirstOrThrow({ where: { matterId } });
      await prisma.invoice.update({
        where: { id: inv.id },
        data: { status: "sent" },
      });

      const res = await setInvoiceStatus(inv.id, next);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/Record payment/i);

      const after = await prisma.invoice.findUnique({ where: { id: inv.id } });
      expect(after!.status).toBe("sent");
      expect(after!.paidAmount.toNumber()).toBe(0);
    }
  );

  test("internal-record draft → paid ('Mark recorded') still sets paidAmount", async () => {
    const inv = await prisma.invoice.create({
      data: {
        invoiceNumber: "2026-800",
        matterId,
        kind: "internal_record",
        issueDate: new Date(),
        dueDate: new Date(),
        subtotal: 500,
        totalAmount: 500,
        paidAmount: 0,
        status: "draft",
      },
      select: { id: true },
    });

    const res = await setInvoiceStatus(inv.id, "paid");
    expect(res.ok).toBe(true);

    const after = await prisma.invoice.findUnique({ where: { id: inv.id } });
    expect(after!.status).toBe("paid");
    expect(after!.paidAmount.toNumber()).toBe(500);
  });
});

// ── sendInvoice — trustAmount validation ────────────────────────────────

const buildSendForm = (overrides: Partial<Record<string, string>> = {}) => {
  const fd = new FormData();
  fd.set("method", overrides.method ?? "email");
  fd.set("recipient", overrides.recipient ?? "client@example.com");
  if (overrides.applyTrust !== undefined) fd.set("applyTrust", overrides.applyTrust);
  if (overrides.trustAmount !== undefined) fd.set("trustAmount", overrides.trustAmount);
  return fd;
};

describe("sendInvoice — trustAmount validation", () => {
  test("garbage trustAmount returns a field error, not a raw DecimalError", async () => {
    const res = await sendInvoice(
      "irrelevant",
      billingInitialState,
      buildSendForm({ applyTrust: "true", trustAmount: "abc" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.trustAmount?.length).toBeGreaterThan(0);
  });

  test("sub-cent trustAmount is rejected (no fractional cents in the trust ledger)", async () => {
    const res = await sendInvoice(
      "irrelevant",
      billingInitialState,
      buildSendForm({ applyTrust: "true", trustAmount: "5.999" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.trustAmount?.length).toBeGreaterThan(0);
  });

  test("'$1,234.56'-style trustAmount passes format validation", async () => {
    // Invoice doesn't exist, so the action fails LATER with
    // "Invoice not found." — proving the amount itself parsed.
    const res = await sendInvoice(
      "no-such-invoice",
      billingInitialState,
      buildSendForm({ applyTrust: "true", trustAmount: "$1,234.56" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.trustAmount).toBeUndefined();
    expect(res.error).toMatch(/not found/i);
  });
});

// ── Concurrency — row locks + out-of-transaction number retry ───────────

const buildPaymentForm = (amount: string) => {
  const fd = new FormData();
  fd.set("amount", amount);
  fd.set("source", "check");
  return fd;
};

describe("billing concurrency", () => {
  test("two concurrent payments can't overpay — the row lock serializes them", async () => {
    const inv = await prisma.invoice.create({
      data: {
        invoiceNumber: "2026-900",
        matterId,
        issueDate: new Date(),
        dueDate: new Date(),
        subtotal: 100,
        totalAmount: 100,
        paidAmount: 0,
        status: "sent",
      },
      select: { id: true },
    });

    // Both request the full balance. Without the FOR UPDATE lock
    // both pass the balance check (READ COMMITTED snapshot) and the
    // invoice ends up with two payment rows + a clobbered paidAmount.
    const [a, b] = await Promise.all([
      recordInvoicePayment(inv.id, billingInitialState, buildPaymentForm("100")),
      recordInvoicePayment(inv.id, billingInitialState, buildPaymentForm("100")),
    ]);
    expect([a.status, b.status].sort()).toEqual(["error", "ok"]);

    const after = await prisma.invoice.findUnique({ where: { id: inv.id } });
    expect(after!.paidAmount.toNumber()).toBe(100);
    expect(after!.status).toBe("paid");
    const payments = await prisma.invoicePayment.count({
      where: { invoiceId: inv.id },
    });
    expect(payments).toBe(1);
  });

  test("two concurrent trust disbursements can't overdraw the matter trust", async () => {
    await prisma.matter.update({
      where: { id: matterId },
      data: { trustBalance: 100 },
    });
    const buildTrustForm = () => {
      const fd = new FormData();
      fd.set("type", "disbursement");
      fd.set("amount", "100");
      fd.set("description", "Concurrent disbursement");
      return fd;
    };

    const [a, b] = await Promise.all([
      addTrustTransaction(matterId, billingInitialState, buildTrustForm()),
      addTrustTransaction(matterId, billingInitialState, buildTrustForm()),
    ]);
    expect([a.status, b.status].sort()).toEqual(["error", "ok"]);

    const matter = await prisma.matter.findUnique({ where: { id: matterId } });
    expect(matter!.trustBalance.toNumber()).toBe(0);
    const txns = await prisma.trustTransaction.count({ where: { matterId } });
    expect(txns).toBe(1);
  });

  test("concurrent generates survive an invoice-number collision (retry re-runs the transaction)", async () => {
    // Two matters, each with WIP — both generates race to mint the
    // same next number. The loser's INSERT aborts its transaction;
    // the retry must re-run the WHOLE transaction to succeed (a
    // retry inside the aborted one always fails on Postgres).
    await seedTimeEntry({ matterId, userId, amount: 100 });
    const area = await seedPracticeArea();
    const other = await seedMatter({
      practiceAreaId: area.areaId,
      stageId: area.stageId,
      leadUserId: userId,
    });
    await seedTimeEntry({ matterId: other.matterId, userId, amount: 200 });

    const [r1, r2] = await Promise.all([
      generateInvoiceFromWip(matterId, billingInitialState, new FormData()),
      generateInvoiceFromWip(other.matterId, billingInitialState, new FormData()),
    ]);
    expect(r1.status).toBe("ok");
    expect(r2.status).toBe("ok");

    const numbers = (
      await prisma.invoice.findMany({ select: { invoiceNumber: true } })
    ).map((i) => i.invoiceNumber);
    expect(numbers).toHaveLength(2);
    expect(new Set(numbers).size).toBe(2);
  });
});

// ── RBAC gates ──────────────────────────────────────────────────────────
//
// Every billing mutation must call requirePermission with its
// catalog key BEFORE doing any work. The mock passes everyone, so
// these assert the key wiring, not the deny path (permission-check
// itself is covered by its own tests).

describe("billing RBAC gates", () => {
  const mockedRequirePermission = vi.mocked(requirePermission);

  test("generateInvoiceFromWip gates on billing.generate_invoice", async () => {
    await generateInvoiceFromWip(matterId, billingInitialState, new FormData());
    expect(mockedRequirePermission).toHaveBeenCalledWith(
      "billing.generate_invoice"
    );
  });

  test("bundleAsInternalRecord gates on billing.generate_invoice", async () => {
    await bundleAsInternalRecord(matterId, billingInitialState, new FormData());
    expect(mockedRequirePermission).toHaveBeenCalledWith(
      "billing.generate_invoice"
    );
  });

  test.each([
    ["approved", "billing.approve_invoice"],
    ["sent", "billing.send_invoice"],
    ["void", "billing.void_invoice"],
    ["paid", "billing.approve_invoice"],
    ["partial", "billing.record_payment"],
  ])("setInvoiceStatus(→ %s) gates on %s", async (next, key) => {
    await setInvoiceStatus("no-such-invoice", next);
    expect(mockedRequirePermission).toHaveBeenCalledWith(key);
  });

  test("setInvoiceStatus refuses an unknown status without gating", async () => {
    const res = await setInvoiceStatus("no-such-invoice", "banana");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unknown/i);
    expect(mockedRequirePermission).not.toHaveBeenCalled();
  });

  test("deleteInvoice gates on billing.delete_draft", async () => {
    await deleteInvoice("no-such-invoice");
    expect(mockedRequirePermission).toHaveBeenCalledWith("billing.delete_draft");
  });

  test("approveInvoice gates on billing.approve_invoice", async () => {
    await approveInvoice("no-such-invoice");
    expect(mockedRequirePermission).toHaveBeenCalledWith(
      "billing.approve_invoice"
    );
  });

  test("addTrustTransaction gates on trust.record_transaction", async () => {
    await addTrustTransaction(matterId, billingInitialState, new FormData());
    expect(mockedRequirePermission).toHaveBeenCalledWith(
      "trust.record_transaction"
    );
  });

  test("recordInvoicePayment gates on billing.record_payment", async () => {
    await recordInvoicePayment(
      "no-such-invoice",
      billingInitialState,
      new FormData()
    );
    expect(mockedRequirePermission).toHaveBeenCalledWith(
      "billing.record_payment"
    );
  });

  test("sendInvoice gates on billing.send_invoice (no trust leg)", async () => {
    await sendInvoice("no-such-invoice", billingInitialState, buildSendForm());
    expect(mockedRequirePermission).toHaveBeenCalledWith("billing.send_invoice");
    expect(mockedRequirePermission).not.toHaveBeenCalledWith(
      "billing.apply_trust"
    );
  });

  test("sendInvoice stacks billing.apply_trust when applyTrust is set", async () => {
    await sendInvoice(
      "no-such-invoice",
      billingInitialState,
      buildSendForm({ applyTrust: "true", trustAmount: "10" })
    );
    expect(mockedRequirePermission).toHaveBeenCalledWith("billing.send_invoice");
    expect(mockedRequirePermission).toHaveBeenCalledWith("billing.apply_trust");
  });
});

// ── Line-item billing gate + audit trail (F019 / F157) ─────────────────

describe("updateInvoiceLineItem — billing gate + audit trail", () => {
  const mockedRequirePermission = vi.mocked(requirePermission);

  test("gates on billing.generate_invoice even for the entry's author", async () => {
    mockedRequirePermission.mockClear();
    const { timeEntryId } = await seedTimeEntry({ matterId, userId, amount: 500 });
    await generateInvoiceFromWip(matterId, billingInitialState, new FormData());
    await updateInvoiceLineItem(
      timeEntryId,
      lineItemEditInitialState,
      buildLineItemForm()
    );
    expect(mockedRequirePermission).toHaveBeenCalledWith(
      "billing.generate_invoice"
    );
  });

  test("a denied billing gate stops the edit before anything is written", async () => {
    const { timeEntryId } = await seedTimeEntry({
      matterId,
      userId,
      hours: 2,
      rate: 250,
      amount: 500,
    });
    await generateInvoiceFromWip(matterId, billingInitialState, new FormData());
    mockedRequirePermission.mockImplementation(async (key: string) => {
      if (key === "billing.generate_invoice") throw new Error("NEXT_REDIRECT");
      return "test-user";
    });
    try {
      await expect(
        updateInvoiceLineItem(
          timeEntryId,
          lineItemEditInitialState,
          buildLineItemForm({ hours: "10", rate: "999" })
        )
      ).rejects.toThrow("NEXT_REDIRECT");
    } finally {
      mockedRequirePermission.mockReset();
      mockedRequirePermission.mockResolvedValue("test-user");
    }
    const te = await prisma.timeEntry.findUniqueOrThrow({
      where: { id: timeEntryId },
    });
    expect(te.rate?.toNumber()).toBe(250);
    expect(te.amount?.toNumber()).toBe(500);
  });

  test("writes an activity-log row with old and new values", async () => {
    const { timeEntryId } = await seedTimeEntry({
      matterId,
      userId,
      hours: 2,
      rate: 250,
      amount: 500,
    });
    await generateInvoiceFromWip(matterId, billingInitialState, new FormData());
    await updateInvoiceLineItem(
      timeEntryId,
      lineItemEditInitialState,
      buildLineItemForm({ hours: "3", rate: "300" })
    );
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { matterId, title: { contains: "line item edited" } },
    });
    expect(log.userId).toBe(userId);
    expect(log.detail).toContain("hours 2 → 3");
    expect(log.detail).toContain("rate $250.00 → $300.00");
    expect(log.detail).toContain("amount $500.00 → $900.00");
    expect(log.detail).toContain("invoice total $500.00 → $900.00");
  });

  test("an approve that lands after the pre-check wins: the edit is refused under the lock", async () => {
    const { timeEntryId } = await seedTimeEntry({ matterId, userId, amount: 500 });
    await generateInvoiceFromWip(matterId, billingInitialState, new FormData());
    const inv = await prisma.invoice.findFirstOrThrow({ where: { matterId } });
    // The pre-check read still sees a draft; by the time the
    // transaction locks the row it has been approved.
    const realFind = prisma.timeEntry.findUnique.bind(prisma.timeEntry);
    const spy = vi
      .spyOn(prisma.timeEntry, "findUnique")
      .mockImplementationOnce((async (args: unknown) => {
        const row = await realFind(args as never);
        await prisma.invoice.update({
          where: { id: inv.id },
          data: { status: "approved" },
        });
        return row;
      }) as never);
    try {
      const res = await updateInvoiceLineItem(
        timeEntryId,
        lineItemEditInitialState,
        buildLineItemForm({ hours: "9", rate: "1000" })
      );
      expect(res.status).toBe("error");
      expect(res.error).toMatch(/approved/i);
    } finally {
      spy.mockRestore();
    }
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.totalAmount.toNumber()).toBe(500);
  });
});

// ── Money rounding (F028 / F164) ───────────────────────────────────────

describe("money rounding — line items + payments", () => {
  test("0.25h x $187.50 is stored as 46.88, the invoice total is 46.88, and paying 46.88 marks it paid", async () => {
    const { timeEntryId } = await seedTimeEntry({ matterId, userId, amount: 100 });
    await generateInvoiceFromWip(matterId, billingInitialState, new FormData());
    const res = await updateInvoiceLineItem(
      timeEntryId,
      lineItemEditInitialState,
      buildLineItemForm({ hours: "0.25", rate: "187.50" })
    );
    expect(res.status).toBe("ok");
    const te = await prisma.timeEntry.findUniqueOrThrow({ where: { id: timeEntryId } });
    expect(te.amount?.toString()).toBe("46.88");
    const inv = await prisma.invoice.findFirstOrThrow({ where: { matterId } });
    expect(inv.subtotal.toString()).toBe("46.88");
    expect(inv.totalAmount.toString()).toBe("46.88");

    await prisma.invoice.update({ where: { id: inv.id }, data: { status: "sent" } });
    const pay = await recordInvoicePayment(
      inv.id,
      billingInitialState,
      buildPaymentForm("46.88")
    );
    expect(pay.status).toBe("ok");
    const paid = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(paid.status).toBe("paid");
    expect(paid.paidAmount.toString()).toBe("46.88");
  });

  test("a legacy sub-cent invoice total (46.875) can still be paid in full at 46.88", async () => {
    const inv = await prisma.invoice.create({
      data: {
        invoiceNumber: "2026-901",
        matterId,
        issueDate: new Date(),
        dueDate: new Date(),
        subtotal: "46.875",
        totalAmount: "46.875",
        paidAmount: 0,
        status: "sent",
      },
      select: { id: true },
    });
    const pay = await recordInvoicePayment(
      inv.id,
      billingInitialState,
      buildPaymentForm("46.88")
    );
    expect(pay.status).toBe("ok");
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.status).toBe("paid");
  });

  test("rejects hours with more than 2 decimals when the hours value changes", async () => {
    const { timeEntryId } = await seedTimeEntry({
      matterId,
      userId,
      hours: 2,
      rate: 275,
      amount: 550,
    });
    await generateInvoiceFromWip(matterId, billingInitialState, new FormData());
    const res = await updateInvoiceLineItem(
      timeEntryId,
      lineItemEditInitialState,
      buildLineItemForm({ hours: "0.123", rate: "275" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.hours?.[0]).toMatch(/2 decimal/i);
    const te = await prisma.timeEntry.findUniqueOrThrow({ where: { id: timeEntryId } });
    expect(te.hours).toBe(2);
  });

  test("a stored 4-decimal hours value can be re-posted unchanged (editing the narrative)", async () => {
    const { timeEntryId } = await seedTimeEntry({
      matterId,
      userId,
      hours: 0.3333,
      rate: 100,
      amount: 33.33,
    });
    await generateInvoiceFromWip(matterId, billingInitialState, new FormData());
    const res = await updateInvoiceLineItem(
      timeEntryId,
      lineItemEditInitialState,
      buildLineItemForm({ hours: "0.3333", rate: "100", narrative: "typo fix" })
    );
    expect(res.status).toBe("ok");
    const te = await prisma.timeEntry.findUniqueOrThrow({ where: { id: timeEntryId } });
    expect(te.amount?.toString()).toBe("33.33");
  });

  test("generate rounds legacy sub-cent entry amounts line by line", async () => {
    await seedTimeEntry({ matterId, userId, hours: 1, rate: 1, amount: 46.875 });
    await seedTimeEntry({ matterId, userId, hours: 1, rate: 1, amount: 10.004 });
    await generateInvoiceFromWip(matterId, billingInitialState, new FormData());
    const inv = await prisma.invoice.findFirstOrThrow({ where: { matterId } });
    expect(inv.totalAmount.toString()).toBe("56.88"); // 46.88 + 10.00
  });
});

// ── Paying from trust needs billing.apply_trust (F020/F029/F031/F077) ──

describe("recordInvoicePayment — trust source gate", () => {
  const mockedRequirePermission = vi.mocked(requirePermission);

  const seedSentInvoice = async () => {
    const inv = await prisma.invoice.create({
      data: {
        invoiceNumber: "2026-902",
        matterId,
        issueDate: new Date(),
        dueDate: new Date(),
        subtotal: 100,
        totalAmount: 100,
        paidAmount: 0,
        status: "sent",
      },
      select: { id: true },
    });
    await prisma.matter.update({
      where: { id: matterId },
      data: { trustBalance: 500 },
    });
    return inv.id;
  };
  const sourceForm = (source: string) => {
    const fd = new FormData();
    fd.set("amount", "40");
    fd.set("source", source);
    return fd;
  };

  test("source=trust additionally requires billing.apply_trust; source=check does not", async () => {
    const invId = await seedSentInvoice();
    mockedRequirePermission.mockClear();
    await recordInvoicePayment(invId, billingInitialState, sourceForm("check"));
    expect(mockedRequirePermission).toHaveBeenCalledWith("billing.record_payment");
    expect(mockedRequirePermission).not.toHaveBeenCalledWith("billing.apply_trust");

    mockedRequirePermission.mockClear();
    await recordInvoicePayment(invId, billingInitialState, sourceForm("trust"));
    expect(mockedRequirePermission).toHaveBeenCalledWith("billing.apply_trust");
  });

  test("a user with record_payment but not apply_trust cannot move trust funds", async () => {
    const invId = await seedSentInvoice();
    mockedRequirePermission.mockImplementation(async (key: string) => {
      if (key === "billing.apply_trust") throw new Error("NEXT_REDIRECT");
      return "test-user";
    });
    try {
      await expect(
        recordInvoicePayment(invId, billingInitialState, sourceForm("trust"))
      ).rejects.toThrow("NEXT_REDIRECT");
      // Non-trust payments still work for the same user.
      const ok = await recordInvoicePayment(
        invId,
        billingInitialState,
        sourceForm("check")
      );
      expect(ok.status).toBe("ok");
    } finally {
      mockedRequirePermission.mockReset();
      mockedRequirePermission.mockResolvedValue("test-user");
    }
    expect(await prisma.trustTransaction.count({ where: { matterId } })).toBe(0);
    const m = await prisma.matter.findUniqueOrThrow({ where: { id: matterId } });
    expect(m.trustBalance.toNumber()).toBe(500);
  });
});

// ── Double-billing races (F156 / F235 / F338) ──────────────────────────

describe("generate / bundle — double-billing races", () => {
  test("two concurrent generates on the SAME matter bill each entry exactly once", async () => {
    await seedTimeEntry({ matterId, userId, amount: 100 });
    await seedTimeEntry({ matterId, userId, amount: 200 });
    await seedExpense({ matterId, amount: 50 });

    const [a, b] = await Promise.all([
      generateInvoiceFromWip(matterId, billingInitialState, new FormData()),
      generateInvoiceFromWip(matterId, billingInitialState, new FormData()),
    ]);
    expect([a.status, b.status].sort()).toEqual(["error", "ok"]);

    const invoices = await prisma.invoice.findMany({
      where: { matterId },
      include: { lineItems: true, expenseLineItems: true },
    });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]!.lineItems).toHaveLength(2);
    expect(invoices[0]!.expenseLineItems).toHaveLength(1);
    expect(invoices[0]!.totalAmount.toNumber()).toBe(350);
  });

  test("a generate and a bundle on the same matter can't both claim the entries", async () => {
    await seedTimeEntry({ matterId, userId, amount: 100 });
    const fd = new FormData();
    fd.set("notes", "closing out");
    const [a, b] = await Promise.all([
      generateInvoiceFromWip(matterId, billingInitialState, new FormData()),
      bundleAsInternalRecord(matterId, billingInitialState, fd),
    ]);
    expect([a.status, b.status].sort()).toEqual(["error", "ok"]);
    expect(await prisma.invoice.count({ where: { matterId } })).toBe(1);
  });

  test("entries billed after the WIP read abort the generate (link count mismatch) and roll back", async () => {
    const { timeEntryId } = await seedTimeEntry({ matterId, userId, amount: 100 });
    const other = await prisma.invoice.create({
      data: {
        invoiceNumber: "2026-950",
        matterId,
        issueDate: new Date(),
        dueDate: new Date(),
        subtotal: 100,
        totalAmount: 100,
        paidAmount: 0,
        status: "draft",
      },
      select: { id: true },
    });
    // Simulate a competing invoice claiming the entry AFTER this
    // transaction read its WIP set but BEFORE it linked the rows:
    // wrap the transaction client so invoice.create first steals the
    // entry. Without the `invoiceId: null` predicate + count check
    // the updateMany would silently re-point it at the new invoice.
    const realTransaction = prisma.$transaction.bind(prisma);
    const txSpy = vi.spyOn(prisma, "$transaction").mockImplementationOnce(((
      cb: (tx: unknown) => Promise<unknown>
    ) =>
      realTransaction((tx) =>
        cb(
          new Proxy(tx, {
            get(target, prop, receiver) {
              const value = Reflect.get(target, prop, receiver);
              if (prop !== "invoice") return value;
              return new Proxy(value, {
                get(t2, p2, r2) {
                  const v2 = Reflect.get(t2, p2, r2);
                  if (p2 !== "create") return v2;
                  return async (args: unknown) => {
                    await tx.timeEntry.update({
                      where: { id: timeEntryId },
                      data: { invoiceId: other.id, status: "billed" },
                    });
                    return v2.call(t2, args);
                  };
                },
              });
            },
          })
        )
      )) as never);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await generateInvoiceFromWip(
        matterId,
        billingInitialState,
        new FormData()
      );
      expect(res.status).toBe("error");
      expect(res.error).toMatch(/changed while the invoice was being created/i);
    } finally {
      txSpy.mockRestore();
      consoleSpy.mockRestore();
    }
    // Rolled back: no second invoice, and the entry was NOT re-pointed.
    expect(await prisma.invoice.count({ where: { matterId } })).toBe(1);
    const te = await prisma.timeEntry.findUniqueOrThrow({ where: { id: timeEntryId } });
    expect(te.invoiceId).toBeNull();
    expect(te.status).toBe("billable");
  });
});

// ── Status transitions lose cleanly to concurrent changes (F132/F274) ──

describe("invoice status transitions — conflict handling", () => {
  let counter = 0;
  const seedInvoiceWithEntry = async (status: string, paidAmount = 0) => {
    counter += 1;
    const inv = await prisma.invoice.create({
      data: {
        invoiceNumber: `2026-97${counter}`,
        matterId,
        issueDate: new Date(),
        dueDate: new Date(),
        subtotal: 100,
        totalAmount: 100,
        paidAmount,
        status,
      },
      select: { id: true },
    });
    const { timeEntryId } = await seedTimeEntry({
      matterId,
      userId,
      amount: 100,
      status: "billed",
      invoiceId: inv.id,
    });
    return { invoiceId: inv.id, timeEntryId };
  };

  test("void loses cleanly to a payment that committed after the read", async () => {
    const { invoiceId, timeEntryId } = await seedInvoiceWithEntry("sent", 40);
    // Stale snapshot as setInvoiceStatus would have read it a moment
    // before the payment landed: sent, nothing paid.
    const realFind = prisma.invoice.findUnique.bind(prisma.invoice);
    const spy = vi
      .spyOn(prisma.invoice, "findUnique")
      .mockImplementationOnce((async (args: unknown) => {
        const row = (await realFind(args as never)) as object | null;
        return row && { ...row, paidAmount: new Prisma.Decimal(0) };
      }) as never);
    try {
      const res = await setInvoiceStatus(invoiceId, "void");
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/changed/i);
    } finally {
      spy.mockRestore();
    }
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(after.status).toBe("sent");
    expect(after.paidAmount.toNumber()).toBe(40);
    // The void's unlink never ran.
    const te = await prisma.timeEntry.findUniqueOrThrow({ where: { id: timeEntryId } });
    expect(te.invoiceId).toBe(invoiceId);
    expect(te.status).toBe("billed");
  });

  test("approve is refused when the draft was already moved on", async () => {
    const { invoiceId } = await seedInvoiceWithEntry("draft");
    const realFind = prisma.invoice.findUnique.bind(prisma.invoice);
    const spy = vi
      .spyOn(prisma.invoice, "findUnique")
      .mockImplementationOnce((async (args: unknown) => {
        const row = await realFind(args as never);
        await prisma.invoice.update({
          where: { id: invoiceId },
          data: { status: "sent" },
        });
        return row;
      }) as never);
    try {
      const res = await approveInvoice(invoiceId);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/changed/i);
    } finally {
      spy.mockRestore();
    }
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(after.status).toBe("sent");
  });

  test("delete is refused (nothing unlinked) when the draft was approved after the read", async () => {
    const { invoiceId, timeEntryId } = await seedInvoiceWithEntry("draft");
    const realFind = prisma.invoice.findUnique.bind(prisma.invoice);
    const spy = vi
      .spyOn(prisma.invoice, "findUnique")
      .mockImplementationOnce((async (args: unknown) => {
        const row = await realFind(args as never);
        await prisma.invoice.update({
          where: { id: invoiceId },
          data: { status: "approved" },
        });
        return row;
      }) as never);
    try {
      const res = await deleteInvoice(invoiceId);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/changed/i);
    } finally {
      spy.mockRestore();
    }
    expect(await prisma.invoice.count({ where: { id: invoiceId } })).toBe(1);
    const te = await prisma.timeEntry.findUniqueOrThrow({ where: { id: timeEntryId } });
    expect(te.invoiceId).toBe(invoiceId);
  });
});

// ── Generic client errors (F416 / F449) ────────────────────────────────

describe("billing actions — generic client errors", () => {
  test("an unexpected (Prisma-style) failure is logged server-side and not leaked", async () => {
    await seedTimeEntry({ matterId, userId, amount: 100 });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const leaky = new Error(
      "Invalid `prisma.invoice.create()` invocation in /var/task/.next/server/chunks/x.js:12"
    );
    const txSpy = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(leaky);
    try {
      const res = await generateInvoiceFromWip(
        matterId,
        billingInitialState,
        new FormData()
      );
      expect(res.status).toBe("error");
      expect(res.error).toBe("Couldn't generate invoice.");
      expect(consoleSpy).toHaveBeenCalledWith(
        "[billing.generateInvoiceFromWip]",
        leaky
      );
    } finally {
      txSpy.mockRestore();
      consoleSpy.mockRestore();
    }
  });

  test("intentional refusals still reach the user verbatim", async () => {
    const res = await generateInvoiceFromWip(
      matterId,
      billingInitialState,
      new FormData()
    );
    expect(res.error).toMatch(/Nothing unbilled/i);
  });
});
