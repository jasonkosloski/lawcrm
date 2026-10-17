/**
 * Copy helpers shared by GenerateInvoiceForm and
 * BundleInternalRecordForm.
 *
 * Both server actions sweep every billable, un-invoiced time entry
 * AND expense on the matter (and refuse only when both are empty), so
 * the CTA / confirmation copy must count both buckets or it
 * understates what the draft will contain.
 */

import { roundMoney } from "@/lib/money";

/** "5 entries", "2 expenses" or "5 entries + 2 expenses". */
export function bundleCountLabel(
  entryCount: number,
  expenseCount: number
): string {
  const parts: string[] = [];
  if (entryCount > 0) {
    parts.push(`${entryCount} ${entryCount === 1 ? "entry" : "entries"}`);
  }
  if (expenseCount > 0) {
    parts.push(`${expenseCount} ${expenseCount === 1 ? "expense" : "expenses"}`);
  }
  return parts.join(" + ");
}

/** Time + expense dollars, rounded to cents (no float dust). */
export function bundleTotal(timeTotal: number, expenseTotal: number): number {
  return roundMoney(timeTotal + expenseTotal).toNumber();
}
