/**
 * Billing queries — server-only.
 *
 * Single read for the matter Billing tab. Returns WIP (unbilled
 * approved time), trust balance + recent transactions, and the
 * matter's invoices. Decimal money is converted to number at the
 * API boundary so the page stays primitive-typed.
 *
 * What WIP means here: time entries with `billable: true`,
 * `noCharge: false`, `invoiceId: null`, AND status that the firm
 * considers "ready to bill" (we treat draft / submitted /
 * billable as candidates). `billed` and `written_off` are
 * deliberately out of WIP — they're already accounted for.
 */

import { prisma } from "@/lib/prisma";

export type WipEntry = {
  id: string;
  date: Date;
  hours: number;
  activity: string;
  narrative: string | null;
  rate: number | null;
  amount: number | null;
  status: string;
  userName: string;
  userInitials: string;
};

export type WipSummary = {
  hoursTotal: number;
  amountTotal: number;
  /** Count of entries pending billing. Drives the "Generate invoice"
   *  button copy ("Generate invoice from N entries"). */
  entryCount: number;
  /** Top-N most recent entries for the inline preview list. */
  recent: WipEntry[];
};

export type TrustTxn = {
  id: string;
  type: string;
  amount: number;
  description: string;
  reference: string | null;
  date: Date;
  createdBy: string | null;
  reconciled: boolean;
  /** When this txn was created by paying an invoice from trust,
   *  the FK back to that invoice. Drives the "Payment to invoice
   *  X" link in the ledger. */
  invoiceId: string | null;
  /** Pre-resolved invoice number for the link label so the ledger
   *  row doesn't need a second query. */
  invoiceNumber: string | null;
};

export type TrustSummary = {
  balance: number;
  transactions: TrustTxn[];
};

export type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  issueDate: Date;
  dueDate: Date;
  /** Days from today until dueDate. Negative when overdue. Null
   *  when status === "paid" / "void" since "due" is no longer
   *  meaningful. */
  daysUntilDue: number | null;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  balance: number;
  status: string;
  /** "client" (today's bills) | "internal_record" (contingency
   *  / pro-bono close-out bundles). Drives label + chip + AR
   *  exclusion downstream. */
  kind: string;
  notes: string | null;
  /** Count of time entries linked to this invoice — drives the
   *  "5 line items" hint on the row without joining heavy. */
  lineItemCount: number;
};

/** A payment received against any invoice on this matter — every
 *  channel (trust, check, ACH, cash, card, other) flows through
 *  the same shape. Drives the matter-level "Received payments"
 *  ledger card on the Billing tab. Joined to its invoice so each
 *  row deep-links into the invoice preview. */
export type ReceivedPaymentRow = {
  id: string;
  date: Date;
  source: string;
  amount: number;
  reference: string | null;
  description: string | null;
  invoiceId: string;
  invoiceNumber: string;
};

export type ReceivedPaymentsSummary = {
  /** Sum of every payment that's ever landed on this matter,
   *  across every channel. Lifetime — not bound by date range. */
  totalReceived: number;
  /** Most recent first. Capped at TRUST_RECENT_LIMIT to mirror the
   *  trust ledger's pagination behavior. */
  rows: ReceivedPaymentRow[];
};

export type MatterBilling = {
  matterId: string;
  /** Which billing flow the matter uses (today every value renders
   *  through the traditional flow with a "not implemented yet"
   *  hint for non-client modes). */
  billingMode: string;
  wip: WipSummary;
  trust: TrustSummary;
  invoices: InvoiceRow[];
  /** Sum of unpaid balances across all open invoices on this
   *  matter. Drives the "Outstanding AR" KPI on the page. */
  outstandingAr: number;
  /** Every payment received on this matter — drives the matter-
   *  level "Received payments" ledger. Distinct from the trust
   *  ledger (which only reflects trust-account movements). */
  receivedPayments: ReceivedPaymentsSummary;
};

const WIP_RECENT_LIMIT = 10;
const TRUST_RECENT_LIMIT = 20;

/// WIP-eligible time-entry statuses. Anything else is either
/// already-billed (`billed`) or excluded (`written_off`).
const WIP_STATUSES = ["draft", "submitted", "billable"] as const;

/** Round a derived money value to cents. Individual Decimal →
 *  number conversions are fine, but arithmetic on the results
 *  reintroduces IEEE-754 dust (e.g. 0.3 - 0.1 =
 *  0.19999999999999998). The payment dialogs default their amount
 *  to `balance.toFixed(2)` and then gate submission on
 *  `parsedAmount > balance` — when the dust lands below the true
 *  value, the untouched "pay in full" default is falsely flagged
 *  as exceeding the balance. Rounding here keeps every derived
 *  balance exactly representable at cent precision. */
function roundToCents(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function getMatterBilling(
  matterId: string
): Promise<MatterBilling> {
  // Shared WIP predicate — the aggregate (totals) and the capped
  // findMany (recent list) below must stay in lockstep or the
  // "Generate invoice from N entries" copy drifts from the preview.
  const wipWhere = {
    matterId,
    billable: true,
    noCharge: false,
    invoiceId: null,
    status: { in: [...WIP_STATUSES] },
  };

  const [
    wipAgg,
    wipRecent,
    trustTxns,
    invoices,
    matter,
    receivedAgg,
    receivedRows,
  ] = await Promise.all([
      // WIP totals summed in the DB. A contingency / long-unbilled
      // matter can have `invoiceId: null` match its entire time
      // history, but only WIP_RECENT_LIMIT rows ever render —
      // aggregating avoids shipping (and hydrating a user join for)
      // every eligible row just to compute a sum.
      prisma.timeEntry.aggregate({
        where: wipWhere,
        _sum: { hours: true, amount: true },
        _count: true,
      }),
      prisma.timeEntry.findMany({
        where: wipWhere,
        orderBy: { date: "desc" },
        take: WIP_RECENT_LIMIT,
        include: { user: { select: { name: true, initials: true } } },
      }),
      prisma.trustTransaction.findMany({
        where: { matterId },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: TRUST_RECENT_LIMIT,
        // Pull the invoiceNumber for the row label so we don't N+1.
        include: { invoice: { select: { invoiceNumber: true } } },
      }),
      prisma.invoice.findMany({
        where: { matterId },
        orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
        include: { _count: { select: { lineItems: true } } },
      }),
      prisma.matter.findUnique({
        where: { id: matterId },
        select: { trustBalance: true, billingMode: true },
      }),
      // Lifetime payment total summed in the DB — every payment ever
      // received on the matter, regardless of channel. We join
      // through invoice → matter so adding a new payment channel
      // later is a write-side concern only — this read picks it up
      // automatically.
      prisma.invoicePayment.aggregate({
        where: { invoice: { matterId } },
        _sum: { amount: true },
      }),
      // The visible rows, capped at TRUST_RECENT_LIMIT to mirror the
      // trust ledger's pagination behavior.
      prisma.invoicePayment.findMany({
        where: { invoice: { matterId } },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: TRUST_RECENT_LIMIT,
        include: {
          invoice: { select: { id: true, invoiceNumber: true } },
        },
      }),
    ]);

  // WIP totals come straight from the aggregate. `_sum` fields are
  // null when no rows match (and amount may be null on legacy /
  // contingent rows either way) — treat as 0.
  const wip: WipSummary = {
    hoursTotal: wipAgg._sum.hours ?? 0,
    amountTotal: wipAgg._sum.amount?.toNumber() ?? 0,
    entryCount: wipAgg._count,
    recent: wipRecent.map((e) => ({
      id: e.id,
      date: e.date,
      hours: e.hours,
      activity: e.activity,
      narrative: e.narrative,
      rate: e.rate?.toNumber() ?? null,
      amount: e.amount?.toNumber() ?? null,
      status: e.status,
      userName: e.user.name,
      userInitials: e.user.initials,
    })),
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayMs = 24 * 60 * 60 * 1000;

  const invoiceRows: InvoiceRow[] = invoices.map((i) => {
    const total = i.totalAmount.toNumber();
    const paid = i.paidAmount.toNumber();
    const isClosed = i.status === "paid" || i.status === "void";
    const daysUntilDue = isClosed
      ? null
      : Math.floor(
          (new Date(i.dueDate).setHours(0, 0, 0, 0) - today.getTime()) / dayMs
        );
    return {
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      issueDate: i.issueDate,
      dueDate: i.dueDate,
      daysUntilDue,
      subtotal: i.subtotal.toNumber(),
      taxAmount: i.taxAmount.toNumber(),
      totalAmount: total,
      paidAmount: paid,
      balance: Math.max(0, roundToCents(total - paid)),
      status: i.status,
      kind: i.kind,
      notes: i.notes,
      lineItemCount: i._count.lineItems,
    };
  });

  // Outstanding AR — sum of balances on every open client invoice.
  // Internal records are deliberately excluded (no money is owed to
  // the firm — the doc just memorializes work done) regardless of
  // their status.
  const outstandingAr = roundToCents(
    invoiceRows
      .filter(
        (i) =>
          i.kind === "client" && i.status !== "paid" && i.status !== "void"
      )
      .reduce((sum, i) => sum + i.balance, 0)
  );

  const trust: TrustSummary = {
    balance: matter?.trustBalance.toNumber() ?? 0,
    transactions: trustTxns.map((t) => ({
      id: t.id,
      type: t.type,
      amount: t.amount.toNumber(),
      description: t.description,
      reference: t.reference,
      date: t.date,
      createdBy: t.createdBy,
      reconciled: t.reconciled,
      invoiceId: t.invoiceId,
      invoiceNumber: t.invoice?.invoiceNumber ?? null,
    })),
  };

  // Received payments — flattened across every invoice on the
  // matter. The lifetime sum comes from the aggregate; the visible
  // rows are already capped at the query so the page doesn't render
  // hundreds of rows on busy matters.
  const receivedShaped: ReceivedPaymentRow[] = receivedRows.map((p) => ({
    id: p.id,
    date: p.date,
    source: p.source,
    amount: p.amount.toNumber(),
    reference: p.reference,
    description: p.description,
    invoiceId: p.invoice.id,
    invoiceNumber: p.invoice.invoiceNumber,
  }));

  return {
    matterId,
    billingMode: matter?.billingMode ?? "client",
    wip,
    trust,
    invoices: invoiceRows,
    outstandingAr,
    receivedPayments: {
      totalReceived: receivedAgg._sum.amount?.toNumber() ?? 0,
      rows: receivedShaped,
    },
  };
}

// ── Invoice detail (preview pane) ───────────────────────────────────────

export type InvoiceLineItem = {
  id: string;
  date: Date;
  hours: number;
  activity: string;
  narrative: string | null;
  rate: number | null;
  amount: number | null;
  /** Author of the underlying TimeEntry. Drives the inline-edit
   *  affordance on the preview pane: an author can always edit
   *  their own entry, even without `time_entries.edit_any`. */
  userId: string;
  /** "Jason Kosloski" — the timekeeper's full name. */
  userName: string;
  /** "Managing Partner" — the timekeeper's display title. */
  userJobTitle: string;
  /** Two-letter initials kept available for legacy callsites
   *  (avatars, dense list views). The invoice itself renders the
   *  full name + jobTitle. */
  userInitials: string;
};

export type InvoiceExpenseLineItem = {
  id: string;
  date: Date;
  description: string;
  category: string;
  amount: number;
  utbmsCode: string | null;
  notes: string | null;
};

/** A payment recorded against an invoice. Sourced from the
 *  `InvoicePayment` table — every channel (trust, check, ACH, cash,
 *  card, other) lands here. Trust payments also write a separate
 *  `TrustTransaction` row for the trust ledger, but the invoice
 *  preview reads from this single table. */
export type InvoicePayment = {
  id: string;
  date: Date;
  /** Channel the payment came in on. UI maps to display label via
   *  `INVOICE_PAYMENT_SOURCE_LABEL`. */
  source: string;
  /** Free-text memo / description. May be null for older trust
   *  rows that pre-date the unified InvoicePayment table. */
  description: string | null;
  /** Check #, wire ID, last-4 — what the user typed when recording. */
  reference: string | null;
  amount: number;
};

export type InvoiceDetail = InvoiceRow & {
  matterId: string;
  matterName: string;
  /** Bill-to client info pulled from the matter's client. The
   *  `Invoice.clientId` field is captured at issue time but for v1
   *  we read through `Matter.client` so renames flow through. */
  clientName: string | null;
  clientEmail: string | null;
  clientAddress: {
    line1: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  } | null;
  lineItems: InvoiceLineItem[];
  /** Expense line items billed alongside time entries. Same
   *  invoice rolls up both buckets under the totals stack. */
  expenseLineItems: InvoiceExpenseLineItem[];
  /** Recorded payments against this invoice — drives the
   *  "Payments received" section on the preview. May be empty
   *  even when paidAmount > 0 if the invoice was Mark-paid
   *  manually (no source TrustTransaction); the totals stack
   *  remains authoritative for "what's been paid". */
  payments: InvoicePayment[];
  /** Sum of `payments[].amount`. The totals stack uses
   *  `paidAmount` (which may be larger if a manual Mark-paid is
   *  in play); this lets the UI flag the gap. */
  paymentsRecordedTotal: number;
};

export async function getInvoiceById(
  invoiceId: string
): Promise<InvoiceDetail | null> {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      matter: {
        select: {
          name: true,
          client: {
            select: {
              name: true,
              email: true,
              address: true,
              city: true,
              state: true,
              zip: true,
            },
          },
        },
      },
      lineItems: {
        orderBy: { date: "asc" },
        include: {
          user: { select: { name: true, initials: true, jobTitle: true } },
        },
      },
      expenseLineItems: {
        orderBy: { date: "asc" },
      },
      payments: {
        // Newest payments float to the top so the most recent
        // activity is visible first. Within a date, createdAt
        // breaks ties.
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      },
      _count: { select: { lineItems: true } },
    },
  });
  if (!inv) return null;

  // Reuse the same daysUntilDue logic as the row shape so the
  // preview's "X days late" text matches the table.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayMs = 24 * 60 * 60 * 1000;
  const total = inv.totalAmount.toNumber();
  const paid = inv.paidAmount.toNumber();
  const isClosed = inv.status === "paid" || inv.status === "void";
  const daysUntilDue = isClosed
    ? null
    : Math.floor(
        (new Date(inv.dueDate).setHours(0, 0, 0, 0) - today.getTime()) / dayMs
      );

  const client = inv.matter.client;

  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    daysUntilDue,
    subtotal: inv.subtotal.toNumber(),
    taxAmount: inv.taxAmount.toNumber(),
    totalAmount: total,
    paidAmount: paid,
    balance: Math.max(0, roundToCents(total - paid)),
    status: inv.status,
    kind: inv.kind,
    notes: inv.notes,
    lineItemCount: inv._count.lineItems,
    matterId: inv.matterId,
    matterName: inv.matter.name,
    clientName: client?.name ?? null,
    clientEmail: client?.email ?? null,
    clientAddress: client
      ? {
          line1: client.address,
          city: client.city,
          state: client.state,
          zip: client.zip,
        }
      : null,
    lineItems: inv.lineItems.map((e) => ({
      id: e.id,
      date: e.date,
      hours: e.hours,
      activity: e.activity,
      narrative: e.narrative,
      rate: e.rate?.toNumber() ?? null,
      amount: e.amount?.toNumber() ?? null,
      userId: e.userId,
      userName: e.user.name,
      userJobTitle: e.user.jobTitle,
      userInitials: e.user.initials,
    })),
    expenseLineItems: inv.expenseLineItems.map((e) => ({
      id: e.id,
      date: e.date,
      description: e.description,
      category: e.category,
      amount: e.amount.toNumber(),
      utbmsCode: e.utbmsCode,
      notes: e.notes,
    })),
    payments: inv.payments.map((p) => ({
      id: p.id,
      date: p.date,
      source: p.source,
      description: p.description,
      reference: p.reference,
      // InvoicePayment.amount is always stored positive — it's the
      // payment side of the ledger, not the trust-account side.
      amount: p.amount.toNumber(),
    })),
    paymentsRecordedTotal: inv.payments.reduce(
      (sum, p) => sum + p.amount.toNumber(),
      0
    ),
  };
}
