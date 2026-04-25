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
  notes: string | null;
  /** Count of time entries linked to this invoice — drives the
   *  "5 line items" hint on the row without joining heavy. */
  lineItemCount: number;
};

export type MatterBilling = {
  matterId: string;
  wip: WipSummary;
  trust: TrustSummary;
  invoices: InvoiceRow[];
  /** Sum of unpaid balances across all open invoices on this
   *  matter. Drives the "Outstanding AR" KPI on the page. */
  outstandingAr: number;
};

const WIP_RECENT_LIMIT = 10;
const TRUST_RECENT_LIMIT = 20;

/// WIP-eligible time-entry statuses. Anything else is either
/// already-billed (`billed`) or excluded (`written_off`).
const WIP_STATUSES = ["draft", "submitted", "billable"] as const;

export async function getMatterBilling(
  matterId: string
): Promise<MatterBilling> {
  const [wipEntries, trustTxns, invoices, matter] = await Promise.all([
    prisma.timeEntry.findMany({
      where: {
        matterId,
        billable: true,
        noCharge: false,
        invoiceId: null,
        status: { in: [...WIP_STATUSES] },
      },
      orderBy: { date: "desc" },
      include: { user: { select: { name: true, initials: true } } },
    }),
    prisma.trustTransaction.findMany({
      where: { matterId },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: TRUST_RECENT_LIMIT,
    }),
    prisma.invoice.findMany({
      where: { matterId },
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
      include: { _count: { select: { lineItems: true } } },
    }),
    prisma.matter.findUnique({
      where: { id: matterId },
      select: { trustBalance: true },
    }),
  ]);

  // WIP totals: sum hours + amount across every eligible entry.
  // amount may be null on legacy / contingent rows — treat as 0.
  let hoursTotal = 0;
  let amountTotal = 0;
  for (const e of wipEntries) {
    hoursTotal += e.hours;
    amountTotal += e.amount?.toNumber() ?? 0;
  }

  const wip: WipSummary = {
    hoursTotal,
    amountTotal,
    entryCount: wipEntries.length,
    recent: wipEntries.slice(0, WIP_RECENT_LIMIT).map((e) => ({
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
      balance: Math.max(0, total - paid),
      status: i.status,
      notes: i.notes,
      lineItemCount: i._count.lineItems,
    };
  });

  // Outstanding AR — sum of balances on every non-paid, non-void
  // invoice. Matches what the firm cares about for cash collection.
  const outstandingAr = invoiceRows
    .filter((i) => i.status !== "paid" && i.status !== "void")
    .reduce((sum, i) => sum + i.balance, 0);

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
    })),
  };

  return {
    matterId,
    wip,
    trust,
    invoices: invoiceRows,
    outstandingAr,
  };
}
