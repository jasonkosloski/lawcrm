/**
 * Behavioral integration tests for the billing money paths: payments
 * on every channel, send-with-trust, trust ledger signs, approve /
 * delete / void guards, internal-record bundling, the $0-invoice
 * guard, send-time invoice dating and the date-only (ADR-012) stamps.
 *
 * Runs against the real test Postgres. The shared Prisma client has a
 * one-connection pool, so nothing here claims to test concurrency —
 * see billing.concurrency.test.ts for real overlapping transactions.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/current-user-tz", () => ({ getCurrentUserTimeZone: vi.fn() }));
vi.mock("@/lib/file-storage", () => {
  const store = new Map<string, Buffer>();
  return {
    statFile: vi.fn(async (k: string) => (store.has(k) ? { size: store.get(k)!.length } : null)),
    readStoredFile: vi.fn(async (k: string) => store.get(k) ?? null),
    storeFile: vi.fn(async (f: File) => {
      const key = `k__${store.size}__${f.name}`;
      store.set(key, Buffer.from(await f.arrayBuffer()));
      return { key, size: f.size, contentType: f.type };
    }),
    deleteFile: vi.fn(async (k: string) => void store.delete(k)),
  };
});
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn().mockResolvedValue("test-user"),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
  userHasPermission: vi.fn().mockResolvedValue(true),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { userHasPermission } from "@/lib/permission-check";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
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
import { billingInitialState, lineItemEditInitialState } from "@/lib/billing-form";
import {
  resetDb,
  seedContact,
  seedExpense,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedTimeEntry,
  seedUser,
} from "@/test/integration-helpers";
import { captureEmails } from "@/test/email-capture";

let userId: string;
let matterId: string;
let invoiceCounter = 0;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

let cap: ReturnType<typeof captureEmails>;

beforeEach(async () => {
  cap = captureEmails();
  await resetDb();
  invoiceCounter = 0;
  const { firmId } = await seedFirm();
  ({ userId } = await seedUser({ firmId }));
  vi.mocked(getCurrentUserId).mockResolvedValue(userId);
  vi.mocked(getCurrentUserTimeZone).mockResolvedValue("America/Denver");
  const area = await seedPracticeArea();
  ({ matterId } = await seedMatter({
    practiceAreaId: area.areaId,
    stageId: area.stageId,
    leadUserId: userId,
  }));
});

afterEach(() => {
  cap.restore();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(getCurrentUserId).mockResolvedValue(userId);
  vi.mocked(getCurrentUserTimeZone).mockResolvedValue("America/Denver");
});

// ── fixtures ────────────────────────────────────────────────────────────

async function makeInvoice(opts: {
  status: string;
  total?: number | string;
  paid?: number | string;
  kind?: string;
  issueDate?: Date;
  dueDate?: Date;
}): Promise<string> {
  invoiceCounter += 1;
  const inv = await prisma.invoice.create({
    data: {
      invoiceNumber: `2026-8${String(invoiceCounter).padStart(2, "0")}`,
      matterId,
      kind: opts.kind ?? "client",
      issueDate: opts.issueDate ?? new Date("2026-10-01T12:00:00Z"),
      dueDate: opts.dueDate ?? new Date("2026-10-31T12:00:00Z"),
      subtotal: opts.total ?? 100,
      totalAmount: opts.total ?? 100,
      paidAmount: opts.paid ?? 0,
      status: opts.status,
    },
    select: { id: true },
  });
  return inv.id;
}

const setTrust = (n: number) =>
  prisma.matter.update({ where: { id: matterId }, data: { trustBalance: n } });

const trustBalance = async () =>
  (await prisma.matter.findUniqueOrThrow({ where: { id: matterId } })).trustBalance.toNumber();

/** Matter.trustBalance must always equal the ledger's signed sum. */
async function expectLedgerMatchesBalance(initial = 0) {
  const agg = await prisma.trustTransaction.aggregate({
    where: { matterId },
    _sum: { amount: true },
  });
  expect(await trustBalance()).toBe(initial + (agg._sum.amount?.toNumber() ?? 0));
}

const trustForm = (type: string, amount: string, date?: string) => {
  const fd = new FormData();
  fd.set("type", type);
  fd.set("amount", amount);
  fd.set("description", `${type} test`);
  if (date) fd.set("date", date);
  return fd;
};

const payForm = (amount: string, source = "check", extra: Record<string, string> = {}) => {
  const fd = new FormData();
  fd.set("amount", amount);
  fd.set("source", source);
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
};

const sendForm = (extra: Record<string, string> = {}) => {
  const fd = new FormData();
  fd.set("method", "email");
  fd.set("recipient", "client@example.com");
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
};

const lineForm = (rate: string, hours = "2") => {
  const fd = new FormData();
  fd.set("date", "2026-04-15");
  fd.set("activity", "Priced work");
  fd.set("narrative", "");
  fd.set("hours", hours);
  fd.set("rate", rate);
  return fd;
};

// ── trust ledger ────────────────────────────────────────────────────────

describe("trust ledger — manual transactions", () => {
  test("deposit raises the balance with a positive ledger row", async () => {
    const res = await addTrustTransaction(
      matterId,
      billingInitialState,
      trustForm("deposit", "$1,250.50"),
    );
    expect(res.status).toBe("ok");
    const rows = await prisma.trustTransaction.findMany({ where: { matterId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount.toString()).toBe("1250.5");
    expect(rows[0]!.type).toBe("deposit");
    expect(await trustBalance()).toBe(1250.5);
    await expectLedgerMatchesBalance();
  });

  test("disbursement and refund are stored negative and lower the balance", async () => {
    await setTrust(500);
    await addTrustTransaction(matterId, billingInitialState, trustForm("disbursement", "100"));
    await addTrustTransaction(matterId, billingInitialState, trustForm("refund", "50"));
    const rows = await prisma.trustTransaction.findMany({
      where: { matterId },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.map((r) => r.amount.toNumber())).toEqual([-100, -50]);
    expect(await trustBalance()).toBe(350);
    await expectLedgerMatchesBalance(500);
  });

  test("a disbursement above the balance is refused with no ledger row", async () => {
    await setTrust(40);
    const res = await addTrustTransaction(
      matterId,
      billingInitialState,
      trustForm("disbursement", "40.01"),
    );
    expect(res.status).toBe("error");
    expect(res.error).toMatch(/overdraw/i);
    expect(await prisma.trustTransaction.count({ where: { matterId } })).toBe(0);
    expect(await trustBalance()).toBe(40);
  });

  test("3-decimal amounts are rejected", async () => {
    const res = await addTrustTransaction(
      matterId,
      billingInitialState,
      trustForm("deposit", "10.005"),
    );
    expect(res.status).toBe("error");
    expect(res.errors?.amount?.length).toBeGreaterThan(0);
    expect(await prisma.trustTransaction.count({ where: { matterId } })).toBe(0);
  });

  test("a picked date is stored as date-only; a blank one is the user's today (not the UTC day)", async () => {
    await addTrustTransaction(
      matterId,
      billingInitialState,
      trustForm("deposit", "10", "2026-03-05"),
    );
    // 2026-11-01T01:00Z is still Oct 31 at 7 pm in Denver.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-01T01:00:00Z") });
    await addTrustTransaction(matterId, billingInitialState, trustForm("deposit", "10"));
    const rows = await prisma.trustTransaction.findMany({
      where: { matterId },
      orderBy: { date: "asc" },
    });
    expect(rows.map((r) => r.date.toISOString())).toEqual([
      "2026-03-05T00:00:00.000Z",
      "2026-10-31T00:00:00.000Z",
    ]);
  });
});

// ── recordInvoicePayment ────────────────────────────────────────────────

describe("recordInvoicePayment", () => {
  test("payment notification only reaches team members with billing.view", async () => {
    const { firmId } = await seedFirm();
    const { userId: allowed } = await seedUser({ firmId });
    const { userId: denied } = await seedUser({ firmId });
    await prisma.matterTeamMember.createMany({
      data: [
        { matterId, userId: allowed, role: "co_counsel" },
        { matterId, userId: denied, role: "co_counsel" },
      ],
    });
    vi.mocked(userHasPermission).mockImplementation(async (id: string) => id !== denied);
    const id = await makeInvoice({ status: "sent", total: 100 });
    const res = await recordInvoicePayment(id, billingInitialState, payForm("30"));
    expect(res.status).toBe("ok");
    const notes = await prisma.notification.findMany({
      where: { type: "invoice_payment_recorded" },
    });
    expect(notes.map((n) => n.userId)).toEqual([allowed]);
    vi.mocked(userHasPermission).mockResolvedValue(true);
  });

  test("a partial then a final check payment move sent → partial → paid", async () => {
    const id = await makeInvoice({ status: "sent", total: 100 });
    const a = await recordInvoicePayment(id, billingInitialState, payForm("30"));
    expect(a.status).toBe("ok");
    let inv = await prisma.invoice.findUniqueOrThrow({ where: { id } });
    expect(inv.status).toBe("partial");
    expect(inv.paidAmount.toNumber()).toBe(30);

    const over = await recordInvoicePayment(id, billingInitialState, payForm("70.01"));
    expect(over.status).toBe("error");
    expect(over.error).toMatch(/exceeds/i);

    const b = await recordInvoicePayment(id, billingInitialState, payForm("70"));
    expect(b.status).toBe("ok");
    inv = await prisma.invoice.findUniqueOrThrow({ where: { id } });
    expect(inv.status).toBe("paid");
    expect(inv.paidAmount.toNumber()).toBe(100);
    expect(await prisma.invoicePayment.count({ where: { invoiceId: id } })).toBe(2);
    expect(await prisma.trustTransaction.count({ where: { matterId } })).toBe(0);
  });

  test("payments are refused on draft, approved and void invoices", async () => {
    for (const status of ["draft", "approved", "void"]) {
      const id = await makeInvoice({ status });
      const res = await recordInvoicePayment(id, billingInitialState, payForm("10"));
      expect(res.status).toBe("error");
      expect(res.error).toMatch(new RegExp(status));
      expect(await prisma.invoicePayment.count({ where: { invoiceId: id } })).toBe(0);
    }
  });

  test("source=trust writes all four records and decrements the trust balance", async () => {
    const id = await makeInvoice({ status: "sent", total: 100 });
    await setTrust(500);
    const res = await recordInvoicePayment(
      id,
      billingInitialState,
      payForm("40", "trust", { reference: "REF-1" }),
    );
    expect(res.status).toBe("ok");

    const txns = await prisma.trustTransaction.findMany({ where: { matterId } });
    expect(txns).toHaveLength(1);
    expect(txns[0]!.type).toBe("disbursement");
    expect(txns[0]!.amount.toNumber()).toBe(-40);
    expect(txns[0]!.invoiceId).toBe(id);
    expect(txns[0]!.description).toBe(
      `Payment to invoice ${(await prisma.invoice.findUniqueOrThrow({ where: { id } })).invoiceNumber}`,
    );

    const pay = await prisma.invoicePayment.findFirstOrThrow({ where: { invoiceId: id } });
    expect(pay.source).toBe("trust");
    expect(pay.amount.toNumber()).toBe(40);
    expect(pay.trustTxnId).toBe(txns[0]!.id);

    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id } });
    expect(inv.status).toBe("partial");
    expect(inv.paidAmount.toNumber()).toBe(40);
    expect(await trustBalance()).toBe(460);
    await expectLedgerMatchesBalance(500);
  });

  test("source=trust above the trust balance is refused and nothing is written", async () => {
    const id = await makeInvoice({ status: "sent", total: 100 });
    await setTrust(30);
    const res = await recordInvoicePayment(id, billingInitialState, payForm("50", "trust"));
    expect(res.status).toBe("error");
    expect(res.error).toMatch(/Trust balance is \$30\.00/);
    expect(await prisma.trustTransaction.count({ where: { matterId } })).toBe(0);
    expect(await prisma.invoicePayment.count({ where: { invoiceId: id } })).toBe(0);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id } })).status).toBe("sent");
    expect(await trustBalance()).toBe(30);
  });

  test("a fractional-cent total is payable to zero at the displayed cent amount", async () => {
    // 0.33h x $325.50 = 107.415 priced through the line-item editor
    // rounds to 107.42, and paying exactly that completes the invoice.
    const { timeEntryId } = await seedTimeEntry({ matterId, userId, amount: 1 });
    await generateInvoiceFromWip(matterId, billingInitialState, new FormData());
    const edit = await updateInvoiceLineItem(
      timeEntryId,
      lineItemEditInitialState,
      lineForm("325.50", "0.33"),
    );
    expect(edit.status).toBe("ok");
    const inv = await prisma.invoice.findFirstOrThrow({ where: { matterId } });
    expect(inv.totalAmount.toString()).toBe("107.42");
    expect((await approveInvoice(inv.id)).ok).toBe(true);
    expect((await sendInvoice(inv.id, billingInitialState, sendForm())).status).toBe("ok");
    const pay = await recordInvoicePayment(inv.id, billingInitialState, payForm("107.42"));
    expect(pay.status).toBe("ok");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("paid");
  });

  test("blank date defaults to the user's calendar day, stored date-only", async () => {
    const id = await makeInvoice({ status: "sent" });
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-01T01:00:00Z") });
    await recordInvoicePayment(id, billingInitialState, payForm("10"));
    const pay = await prisma.invoicePayment.findFirstOrThrow({ where: { invoiceId: id } });
    expect(pay.date.toISOString()).toBe("2026-10-31T00:00:00.000Z");
  });

  test("a picked date is stored at UTC midnight regardless of the server zone", async () => {
    const id = await makeInvoice({ status: "sent" });
    await recordInvoicePayment(
      id,
      billingInitialState,
      payForm("10", "check", { date: "2026-04-15" }),
    );
    const pay = await prisma.invoicePayment.findFirstOrThrow({ where: { invoiceId: id } });
    expect(pay.date.toISOString()).toBe("2026-04-15T00:00:00.000Z");
  });

  test("a failing team lookup after commit does not turn the saved payment into an error", async () => {
    const id = await makeInvoice({ status: "sent", total: 100 });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(prisma.matterTeamMember, "findMany").mockRejectedValueOnce(new Error("pool timeout"));
    const res = await recordInvoicePayment(id, billingInitialState, payForm("25"));
    expect(res.status).toBe("ok");
    expect(consoleSpy).toHaveBeenCalled();
    expect(await prisma.invoicePayment.count({ where: { invoiceId: id } })).toBe(1);
  });

  test("notifyClient emails the updated invoice and logs the delivery", async () => {
    const id = await makeInvoice({ status: "sent", total: 100 });
    const { contactId } = await seedContact({ name: "Pat Client", email: "pat@example.com" });
    await prisma.matter.update({ where: { id: matterId }, data: { clientId: contactId } });
    await recordInvoicePayment(
      id,
      billingInitialState,
      payForm("25", "check", { notifyClient: "true" }),
    );
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id } });
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { matterId, title: { contains: "emailed to" } },
    });
    expect(log.title).toBe(`Updated invoice ${inv.invoiceNumber} emailed to pat@example.com`);
  });
});

// ── sendInvoice ─────────────────────────────────────────────────────────

describe("sendInvoice", () => {
  test("send without trust: approved → sent, emailed and logged", async () => {
    const id = await makeInvoice({ status: "approved", total: 100 });
    const res = await sendInvoice(id, billingInitialState, sendForm());
    expect(res.status).toBe("ok");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id } })).status).toBe("sent");
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id } });
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { matterId, title: { contains: "emailed to" } },
    });
    expect(log.title).toBe(`Invoice ${inv.invoiceNumber} emailed to client@example.com`);
  });

  test("only approved client invoices can be sent", async () => {
    for (const status of ["draft", "sent", "void"]) {
      const id = await makeInvoice({ status });
      const res = await sendInvoice(id, billingInitialState, sendForm());
      expect(res.status).toBe("error");
      expect(res.error).toMatch(/approved/);
    }
    const internal = await makeInvoice({ status: "draft", kind: "internal_record" });
    const res = await sendInvoice(internal, billingInitialState, sendForm());
    expect(res.error).toMatch(/Only client invoices/);
  });

  test("apply-trust capped by the invoice balance pays it in full", async () => {
    const id = await makeInvoice({ status: "approved", total: 100 });
    await setTrust(500);
    const res = await sendInvoice(id, billingInitialState, sendForm({ applyTrust: "true" }));
    expect(res.status).toBe("ok");
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id } });
    expect(inv.status).toBe("paid");
    expect(inv.paidAmount.toNumber()).toBe(100);
    expect(await trustBalance()).toBe(400);
    const pay = await prisma.invoicePayment.findFirstOrThrow({ where: { invoiceId: id } });
    expect(pay.description).toBe("Earned-fee transfer applied at invoice send");
    expect(pay.trustTxnId).not.toBeNull();
    await expectLedgerMatchesBalance(500);
  });

  test("apply-trust capped by a small trust balance leaves the invoice partial", async () => {
    const id = await makeInvoice({ status: "approved", total: 100 });
    await setTrust(30);
    const res = await sendInvoice(id, billingInitialState, sendForm({ applyTrust: "true" }));
    expect(res.status).toBe("ok");
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id } });
    expect(inv.status).toBe("partial");
    expect(inv.paidAmount.toNumber()).toBe(30);
    expect(await trustBalance()).toBe(0);
  });

  test("a trust amount above the cap is refused and rolls everything back", async () => {
    const id = await makeInvoice({ status: "approved", total: 100 });
    await setTrust(30);
    const res = await sendInvoice(
      id,
      billingInitialState,
      sendForm({ applyTrust: "true", trustAmount: "30.01" }),
    );
    expect(res.status).toBe("error");
    expect(res.error).toMatch(/at most \$30\.00/);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id } })).status).toBe("approved");
    expect(await prisma.trustTransaction.count({ where: { matterId } })).toBe(0);
    expect(await trustBalance()).toBe(30);
  });

  test("send-time trust stamps are date-only: 7 pm Denver on Oct 31 is Oct 31, not Nov 1", async () => {
    const id = await makeInvoice({ status: "approved", total: 100 });
    await setTrust(100);
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-01T01:00:00Z") });
    await sendInvoice(id, billingInitialState, sendForm({ applyTrust: "true", trustAmount: "40" }));
    const txn = await prisma.trustTransaction.findFirstOrThrow({ where: { matterId } });
    const pay = await prisma.invoicePayment.findFirstOrThrow({ where: { invoiceId: id } });
    expect(txn.date.toISOString()).toBe("2026-10-31T00:00:00.000Z");
    expect(pay.date.toISOString()).toBe("2026-10-31T00:00:00.000Z");
  });

  test("sending dates the invoice now and keeps its payment terms (no pre-overdue invoices)", async () => {
    // Draft generated Oct 1 on 30-day terms, approved late, sent Nov 5.
    const id = await makeInvoice({
      status: "approved",
      total: 100,
      issueDate: new Date("2026-10-01T15:00:00Z"),
      dueDate: new Date("2026-10-31T15:00:00Z"),
    });
    const now = new Date("2026-11-05T18:00:00Z");
    vi.useFakeTimers({ toFake: ["Date"], now });
    await sendInvoice(id, billingInitialState, sendForm());
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id } });
    expect(inv.issueDate.toISOString()).toBe("2026-11-05T18:00:00.000Z");
    expect(inv.dueDate.toISOString()).toBe("2026-12-05T18:00:00.000Z");
    expect(inv.status).toBe("sent");
  });
});

// ── $0 invoices ─────────────────────────────────────────────────────────

describe("$0 (unpriced) invoices", () => {
  const unpricedInvoice = async () => {
    const { timeEntryId } = await seedTimeEntry({ matterId, userId });
    // The real shape: time is logged without a rate.
    await prisma.timeEntry.update({
      where: { id: timeEntryId },
      data: { rate: null, amount: null },
    });
    await generateInvoiceFromWip(matterId, billingInitialState, new FormData());
    const inv = await prisma.invoice.findFirstOrThrow({ where: { matterId } });
    return { timeEntryId, invoiceId: inv.id };
  };

  test("generating from unpriced time yields a $0 draft", async () => {
    const { invoiceId } = await unpricedInvoice();
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(inv.totalAmount.toNumber()).toBe(0);
    expect(inv.status).toBe("draft");
  });

  test("approve refuses a $0 client invoice and leaves it a draft", async () => {
    const { invoiceId } = await unpricedInvoice();
    const res = await approveInvoice(invoiceId);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/price the line items/i);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status).toBe(
      "draft",
    );
  });

  test("send refuses a $0 invoice: it must not flip to 'paid' and lock its time entries", async () => {
    const { invoiceId, timeEntryId } = await unpricedInvoice();
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: "approved" } });
    const res = await sendInvoice(invoiceId, billingInitialState, sendForm());
    expect(res.status).toBe("error");
    expect(res.error).toMatch(/price the line items/i);
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(inv.status).toBe("approved");
    // Still recoverable: void releases the entry back to WIP.
    expect((await setInvoiceStatus(invoiceId, "void")).ok).toBe(true);
    const te = await prisma.timeEntry.findUniqueOrThrow({ where: { id: timeEntryId } });
    expect(te.invoiceId).toBeNull();
    expect(te.status).toBe("billable");
  });

  test("pricing the lines first makes the same invoice approvable and sendable", async () => {
    const { invoiceId, timeEntryId } = await unpricedInvoice();
    expect(
      (await updateInvoiceLineItem(timeEntryId, lineItemEditInitialState, lineForm("200"))).status,
    ).toBe("ok");
    expect((await approveInvoice(invoiceId)).ok).toBe(true);
    expect((await sendInvoice(invoiceId, billingInitialState, sendForm())).status).toBe("ok");
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(inv.status).toBe("sent");
    expect(inv.totalAmount.toNumber()).toBe(400);
  });

  test("an expenses-only invoice is not $0 and can be approved", async () => {
    await seedExpense({ matterId, amount: 90 });
    await generateInvoiceFromWip(matterId, billingInitialState, new FormData());
    const inv = await prisma.invoice.findFirstOrThrow({ where: { matterId } });
    expect(inv.totalAmount.toNumber()).toBe(90);
    expect((await approveInvoice(inv.id)).ok).toBe(true);
  });
});

// ── approve ─────────────────────────────────────────────────────────────

describe("approveInvoice", () => {
  test("draft → approved, with an audit row", async () => {
    const id = await makeInvoice({ status: "draft" });
    expect((await approveInvoice(id)).ok).toBe(true);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id } })).status).toBe("approved");
    expect(
      await prisma.activityLog.count({ where: { matterId, title: { contains: "approved" } } }),
    ).toBe(1);
  });

  test("guards: unknown, non-draft and internal-record invoices", async () => {
    expect((await approveInvoice("nope")).error).toMatch(/not found/i);
    const sent = await makeInvoice({ status: "sent" });
    expect((await approveInvoice(sent)).error).toMatch(/draft/);
    const rec = await makeInvoice({ status: "draft", kind: "internal_record" });
    expect((await approveInvoice(rec)).error).toMatch(/Only client invoices/);
  });

  test("an expectedTotal that no longer matches is refused (approver must see what they sign)", async () => {
    const id = await makeInvoice({ status: "draft", total: 100 });
    const stale = await approveInvoice(id, "80.00");
    expect(stale.ok).toBe(false);
    expect(stale.error).toMatch(/changed/i);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id } })).status).toBe("draft");
    expect((await approveInvoice(id, "100.00")).ok).toBe(true);
  });

  test("a total edited between the read and the write is refused", async () => {
    const id = await makeInvoice({ status: "draft", total: 100 });
    const realFind = prisma.invoice.findUnique.bind(prisma.invoice);
    vi.spyOn(prisma.invoice, "findUnique")
      .mockImplementationOnce(realFind as never) // 1st read: matter-access resolver
      .mockImplementationOnce((async (args: unknown) => {
        const row = await realFind(args as never);
        // A line-item edit commits after the approver's read.
        await prisma.invoice.update({
          where: { id },
          data: { totalAmount: 250, subtotal: 250 },
        });
        return row;
      }) as never);
    const res = await approveInvoice(id);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/changed/i);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id } })).status).toBe("draft");
  });

  test("a database failure comes back as { ok: false }, not a thrown error", async () => {
    const id = await makeInvoice({ status: "draft" });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(prisma.invoice, "updateMany").mockRejectedValueOnce(new Error("pool timeout"));
    const res = await approveInvoice(id);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Couldn't update the invoice.");
    expect(consoleSpy).toHaveBeenCalled();
  });

  test("a row deleted mid-flight (P2025) reads 'Invoice not found.'", async () => {
    const id = await makeInvoice({ status: "draft" });
    vi.spyOn(prisma.invoice, "updateMany").mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("gone", {
        code: "P2025",
        clientVersion: "test",
      }),
    );
    const res = await approveInvoice(id);
    expect(res).toEqual({ ok: false, error: "Invoice not found." });
  });
});

// ── delete ──────────────────────────────────────────────────────────────

describe("deleteInvoice", () => {
  test("deleting a draft returns its time entries to billable WIP and expenses to unbilled", async () => {
    const { timeEntryId } = await seedTimeEntry({ matterId, userId, amount: 100 });
    const { expenseId } = await seedExpense({ matterId, amount: 20 });
    await generateInvoiceFromWip(matterId, billingInitialState, new FormData());
    const inv = await prisma.invoice.findFirstOrThrow({ where: { matterId } });

    expect((await deleteInvoice(inv.id)).ok).toBe(true);
    expect(await prisma.invoice.count({ where: { matterId } })).toBe(0);
    const te = await prisma.timeEntry.findUniqueOrThrow({ where: { id: timeEntryId } });
    expect(te.invoiceId).toBeNull();
    expect(te.status).toBe("billable");
    expect(
      (await prisma.expense.findUniqueOrThrow({ where: { id: expenseId } })).invoiceId,
    ).toBeNull();
    expect(
      await prisma.activityLog.count({ where: { matterId, title: { contains: "deleted" } } }),
    ).toBe(1);
  });

  test("non-drafts, paid-against and internal records cannot be deleted", async () => {
    for (const status of ["approved", "sent", "partial", "paid", "void"]) {
      const id = await makeInvoice({ status });
      const res = await deleteInvoice(id);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/Only draft client invoices/);
      expect(await prisma.invoice.count({ where: { id } })).toBe(1);
    }
    const rec = await makeInvoice({ status: "draft", kind: "internal_record" });
    expect((await deleteInvoice(rec)).ok).toBe(false);
    expect((await deleteInvoice("nope")).error).toMatch(/not found/i);
  });

  test("a database failure comes back as { ok: false }", async () => {
    const id = await makeInvoice({ status: "draft" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("pool timeout"));
    const res = await deleteInvoice(id);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Couldn't update the invoice.");
  });
});

// ── void ────────────────────────────────────────────────────────────────

describe("setInvoiceStatus — void", () => {
  test("void is refused once a payment has landed", async () => {
    const id = await makeInvoice({ status: "sent", total: 100 });
    await recordInvoicePayment(id, billingInitialState, payForm("10"));
    const res = await setInvoiceStatus(id, "void");
    expect(res.ok).toBe(false);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id } })).status).toBe("partial");
  });

  test("void is refused on a 'sent' row that carries payments (data-drift guard)", async () => {
    const id = await makeInvoice({ status: "sent", total: 100, paid: 40 });
    const res = await setInvoiceStatus(id, "void");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/payments recorded/i);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id } })).status).toBe("sent");
  });

  test("draft client invoices cannot be voided (delete them instead)", async () => {
    const id = await makeInvoice({ status: "draft" });
    const res = await setInvoiceStatus(id, "void");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Can't transition/);
  });

  test("a database failure comes back as { ok: false }", async () => {
    const id = await makeInvoice({ status: "approved" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("pool timeout"));
    const res = await setInvoiceStatus(id, "void");
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Couldn't update the invoice.");
  });
});

// ── bundleAsInternalRecord ──────────────────────────────────────────────

describe("bundleAsInternalRecord", () => {
  const notesForm = (notes = "Settled; fee collected elsewhere") => {
    const fd = new FormData();
    fd.set("notes", notes);
    return fd;
  };

  test("is born paid ('Recorded') with the WIP and expenses swept, and logs both buckets", async () => {
    const t = await seedTimeEntry({ matterId, userId, amount: 300 });
    const e1 = await seedExpense({ matterId, amount: 40 });
    const e2 = await seedExpense({ matterId, amount: 60 });
    const res = await bundleAsInternalRecord(matterId, billingInitialState, notesForm());
    expect(res.status).toBe("ok");

    const inv = await prisma.invoice.findFirstOrThrow({ where: { matterId } });
    expect(inv.kind).toBe("internal_record");
    expect(inv.status).toBe("paid");
    expect(inv.totalAmount.toNumber()).toBe(400);
    expect(inv.paidAmount.toNumber()).toBe(400);
    expect(inv.issueDate.getTime()).toBe(inv.dueDate.getTime());
    expect(
      (await prisma.timeEntry.findUniqueOrThrow({ where: { id: t.timeEntryId } })).status,
    ).toBe("billed");
    for (const e of [e1, e2]) {
      expect(
        (await prisma.expense.findUniqueOrThrow({ where: { id: e.expenseId } })).invoiceId,
      ).toBe(inv.id);
    }
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { matterId, title: { contains: "bundled" } },
    });
    expect(log.detail).toBe(
      "1 time entry + 2 expenses · $400.00 (Settled; fee collected elsewhere)",
    );
  });

  test("an expenses-only bundle reads '4 expenses', not '0 time entries'", async () => {
    for (let i = 0; i < 4; i++) await seedExpense({ matterId, amount: 225 });
    await bundleAsInternalRecord(matterId, billingInitialState, notesForm("closing"));
    const log = await prisma.activityLog.findFirstOrThrow({
      where: { matterId, title: { contains: "bundled" } },
    });
    expect(log.detail).toBe("4 expenses · $900.00 (closing)");
  });

  test("no-charge time stays in WIP", async () => {
    const nc = await seedTimeEntry({ matterId, userId, amount: 500 });
    await prisma.timeEntry.update({ where: { id: nc.timeEntryId }, data: { noCharge: true } });
    await seedTimeEntry({ matterId, userId, amount: 100 });
    await bundleAsInternalRecord(matterId, billingInitialState, notesForm());
    const inv = await prisma.invoice.findFirstOrThrow({ where: { matterId } });
    expect(inv.totalAmount.toNumber()).toBe(100);
    expect(
      (await prisma.timeEntry.findUniqueOrThrow({ where: { id: nc.timeEntryId } })).invoiceId,
    ).toBeNull();
  });

  test("requires a reason", async () => {
    await seedTimeEntry({ matterId, userId });
    const res = await bundleAsInternalRecord(matterId, billingInitialState, notesForm("  "));
    expect(res.status).toBe("error");
    expect(res.errors?.notes?.length).toBeGreaterThan(0);
  });
});

// ── invoice numbering ───────────────────────────────────────────────────

describe("invoice numbers", () => {
  test("the year is the user's calendar year, not the UTC server year", async () => {
    // 2027-01-01T03:00Z is Dec 31 8 pm in Denver, but already 2027 in Tokyo.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2027-01-01T03:00:00Z") });
    await seedTimeEntry({ matterId, userId });
    await generateInvoiceFromWip(matterId, billingInitialState, new FormData());
    expect((await prisma.invoice.findFirstOrThrow({ where: { matterId } })).invoiceNumber).toBe(
      "2026-001",
    );

    vi.mocked(getCurrentUserTimeZone).mockResolvedValue("Asia/Tokyo");
    await seedTimeEntry({ matterId, userId });
    await generateInvoiceFromWip(matterId, billingInitialState, new FormData());
    const numbers = (await prisma.invoice.findMany({ select: { invoiceNumber: true } })).map(
      (i) => i.invoiceNumber,
    );
    expect(numbers.sort()).toEqual(["2026-001", "2027-001"]);
  });

  test("numbers continue max + 1; a deleted newest draft's number is reused (gap-free by design)", async () => {
    await seedTimeEntry({ matterId, userId });
    await generateInvoiceFromWip(matterId, billingInitialState, new FormData());
    const first = await prisma.invoice.findFirstOrThrow({ where: { matterId } });
    await deleteInvoice(first.id);
    await generateInvoiceFromWip(matterId, billingInitialState, new FormData());
    const again = await prisma.invoice.findFirstOrThrow({ where: { matterId } });
    expect(again.invoiceNumber).toBe(first.invoiceNumber);
  });
});

// ── line-item pricing ───────────────────────────────────────────────────

describe("updateInvoiceLineItem — unparseable numbers", () => {
  test("non-numeric rate or hours come back as field errors, never a raw DecimalError", async () => {
    const { timeEntryId } = await seedTimeEntry({ matterId, userId });
    await generateInvoiceFromWip(matterId, billingInitialState, new FormData());
    const badRate = await updateInvoiceLineItem(
      timeEntryId,
      lineItemEditInitialState,
      lineForm("abc"),
    );
    expect(badRate.status).toBe("error");
    expect(badRate.errors?.rate?.length).toBeGreaterThan(0);
    const badHours = await updateInvoiceLineItem(
      timeEntryId,
      lineItemEditInitialState,
      lineForm("100", "x"),
    );
    expect(badHours.status).toBe("error");
    expect(badHours.errors?.hours?.length).toBeGreaterThan(0);
  });

  test("a leading/trailing-space rate is trimmed and accepted", async () => {
    const { timeEntryId } = await seedTimeEntry({ matterId, userId });
    await generateInvoiceFromWip(matterId, billingInitialState, new FormData());
    const res = await updateInvoiceLineItem(
      timeEntryId,
      lineItemEditInitialState,
      lineForm(" 100 ", " 1.5 "),
    );
    expect(res.status).toBe("ok");
    const te = await prisma.timeEntry.findUniqueOrThrow({ where: { id: timeEntryId } });
    expect(te.amount?.toNumber()).toBe(150);
  });

  test("the line date is stored date-only at UTC midnight", async () => {
    const { timeEntryId } = await seedTimeEntry({ matterId, userId });
    await generateInvoiceFromWip(matterId, billingInitialState, new FormData());
    await updateInvoiceLineItem(timeEntryId, lineItemEditInitialState, lineForm("100"));
    const te = await prisma.timeEntry.findUniqueOrThrow({ where: { id: timeEntryId } });
    expect(te.date.toISOString()).toBe("2026-04-15T00:00:00.000Z");
  });
});
