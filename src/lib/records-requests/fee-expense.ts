/**
 * The one definition of how a paid records fee becomes an Expense, shared
 * by `saveRecordsFee` and lead conversion so the two can't drift.
 */

import type { Prisma } from "@/generated/prisma/client";

/** Description line: `Records — {custodian} ({type name or ad hoc name})`. */
export function recordsFeeDescription(r: {
  custodianName: string;
  typeName: string | null;
  adHocTypeName: string | null;
}): string {
  return `Records — ${r.custodianName} (${r.typeName ?? r.adHocTypeName ?? "records"})`;
}

/** Only a positive fee with a paid date is booked (a $0 fee never is). */
export function feeMakesExpense(feeAmount: Prisma.Decimal | null, feePaidAt: Date | null): boolean {
  return !!feeAmount && feeAmount.gt(0) && !!feePaidAt;
}

export function recordsFeeExpenseData(a: {
  matterId: string;
  loggedBy: string;
  feePaidAt: Date;
  feeAmount: Prisma.Decimal;
  description: string;
}): Prisma.ExpenseUncheckedCreateInput {
  return {
    matterId: a.matterId,
    loggedBy: a.loggedBy,
    date: a.feePaidAt,
    description: a.description,
    category: "records",
    amount: a.feeAmount,
    billable: true,
  };
}
