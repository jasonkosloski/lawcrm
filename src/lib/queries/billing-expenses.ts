/**
 * Unbilled-expense summary for the matter Billing tab.
 *
 * `getMatterBilling`'s WIP summary covers time entries only, but the
 * generate-invoice and bundle-as-internal-record actions also sweep
 * every billable, un-invoiced expense on the matter (and only refuse
 * when BOTH buckets are empty). The WIP card, the Generate CTA and
 * the bundle copy read this summary so they describe what the server
 * will actually bundle.
 *
 * The predicate below MUST stay identical to the `tx.expense.findMany`
 * in `generateInvoiceFromWip` / `bundleAsInternalRecord`
 * (src/app/actions/billing.ts) or the copy drifts from the invoice.
 */

import { prisma } from "@/lib/prisma";

export type UnbilledExpenseSummary = {
  count: number;
  /** Sum of amounts, in dollars (Decimal converted at the boundary). */
  total: number;
};

export async function getUnbilledExpenseSummary(
  matterId: string
): Promise<UnbilledExpenseSummary> {
  const agg = await prisma.expense.aggregate({
    where: { matterId, billable: true, invoiceId: null },
    _sum: { amount: true },
    _count: true,
  });
  return {
    count: agg._count,
    total: agg._sum.amount?.toNumber() ?? 0,
  };
}
