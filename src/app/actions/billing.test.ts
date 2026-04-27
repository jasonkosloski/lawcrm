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
  generateInvoiceFromWip,
  setInvoiceStatus,
  updateInvoiceLineItem,
} from "@/app/actions/billing";
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

  test.each(["sent", "partial", "paid", "void"])(
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

  test("allows edits on draft AND approved invoices", async () => {
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
    const approvedRes = await updateInvoiceLineItem(
      timeEntryId,
      lineItemEditInitialState,
      buildLineItemForm({ activity: "Approved-state edit" })
    );
    expect(approvedRes.status).toBe("ok");
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
