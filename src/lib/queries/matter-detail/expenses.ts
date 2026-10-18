/**
 * Matter Detail — Expenses tab reader.
 */

import { prisma } from "@/lib/prisma";

// ── Matter expenses ────────────────────────────────────────────────────

export type ExpenseRow = {
  id: string;
  date: Date;
  description: string;
  category: string;
  amount: number;
  utbmsCode: string | null;
  billable: boolean;
  clientAdvanced: boolean;
  notes: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  loggerName: string | null;
  loggerInitials: string | null;
  /** When set, the expense has an attached receipt Document.
   *  Drives the "📎 Receipt" chip + open link on the row. */
  receiptDocumentId: string | null;
  receiptDocumentName: string | null;
  /** True when the receipt document has a file blob (downloads
   *  available). Documents created without a file still surface
   *  as a receipt link (chip), just without a download. */
  receiptHasFile: boolean;
};

export type ExpenseSummary = {
  rows: ExpenseRow[];
  /** Sum of all expenses on the matter (every row, regardless of
   *  billable / billed state). Useful for an "expenses to date" KPI. */
  totalAmount: number;
  /** Sum of billable + un-invoiced rows — the candidate set the next
   *  invoice will pull from. */
  billableUnbilledAmount: number;
};

/** Pull every expense row on a matter, ordered newest-first. Joined
 *  to invoice number for the "billed on Invoice X" link, and to the
 *  logger user for attribution on the row. */
export async function getMatterExpenses(
  matterId: string
): Promise<ExpenseSummary> {
  const rows = await prisma.expense.findMany({
    where: { matterId },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: {
      invoice: { select: { invoiceNumber: true } },
      receiptDocument: {
        select: { id: true, name: true, fileUrl: true },
      },
    },
  });
  // Resolve loggers in one batch — same pattern as documents.
  const loggerIds = [
    ...new Set(rows.map((r) => r.loggedBy).filter((v): v is string => !!v)),
  ];
  const loggers =
    loggerIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: loggerIds } },
          select: { id: true, name: true, initials: true },
        })
      : [];
  const loggerById = new Map(loggers.map((u) => [u.id, u]));

  let totalAmount = 0;
  let billableUnbilledAmount = 0;
  const shaped: ExpenseRow[] = rows.map((r) => {
    const amt = r.amount.toNumber();
    totalAmount += amt;
    if (r.billable && !r.invoiceId) billableUnbilledAmount += amt;
    const logger = r.loggedBy ? loggerById.get(r.loggedBy) : null;
    return {
      id: r.id,
      date: r.date,
      description: r.description,
      category: r.category,
      amount: amt,
      utbmsCode: r.utbmsCode,
      billable: r.billable,
      clientAdvanced: r.clientAdvanced,
      notes: r.notes,
      invoiceId: r.invoiceId,
      invoiceNumber: r.invoice?.invoiceNumber ?? null,
      loggerName: logger?.name ?? null,
      loggerInitials: logger?.initials ?? null,
      receiptDocumentId: r.receiptDocument?.id ?? null,
      receiptDocumentName: r.receiptDocument?.name ?? null,
      receiptHasFile: !!r.receiptDocument?.fileUrl,
    };
  });

  return {
    rows: shaped,
    totalAmount,
    billableUnbilledAmount,
  };
}
