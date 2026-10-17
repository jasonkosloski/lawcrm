/**
 * Money rows in ActivityLog — one rule for every feed (F085 / F145).
 *
 * Settlement, expense and trust rows carry amounts (gross, lienholder,
 * negotiated, expense, ledger movement) in their titles. Each feed
 * that lists ActivityLog rows — the matter Timeline, the dashboard
 * "Recent activity" card, Settings → Activity — must hide them from
 * viewers without the matching view key, exactly as the settlement /
 * expense / billing UI does. Rows are omitted, not redacted, so counts
 * never hint at hidden rows.
 *
 * Settings → Activity is no exception: `firm.view_activity` is "see
 * the audit trail", not "see every number". A dedicated auditor role
 * should also hold the three view keys (Admins hold everything).
 */

import type { Prisma } from "@/generated/prisma/client";
import { currentUserHasPermission } from "@/lib/permission-check";
import { EXPENSE_ACTIVITY_TITLE_PREFIX } from "@/lib/expense-activity";

export type ActivityMoneyAccess = {
  /** Holds matters.settlement.view — settlement / lien rows carry
   *  gross, lienholder and negotiated amounts in their titles. */
  canViewSettlement?: boolean;
  /** Holds matters.expense.view — expense rows (logged as type
   *  "filing", title prefix "Expense ") carry amounts + descriptions. */
  canViewExpense?: boolean;
  /** Holds billing.view - trust deposit / disbursement rows (type
   *  "deposit") carry amounts and ledger movement. */
  canViewBilling?: boolean;
};

/** Prisma AND-clauses that hide the rows a viewer may not see.
 *  Settlement rows are hidden whole (type "settlement"), trust rows
 *  whole (type "deposit"), expense rows by their title prefix — the
 *  writer goes through src/lib/expense-activity.ts, so the two can't
 *  drift. */
export function activityMoneyFilters(
  access: ActivityMoneyAccess
): Prisma.ActivityLogWhereInput[] {
  const clauses: Prisma.ActivityLogWhereInput[] = [];
  if (!access.canViewBilling) {
    clauses.push({ type: { not: "deposit" } });
  }
  if (!access.canViewSettlement) {
    clauses.push({ type: { not: "settlement" } });
  }
  if (!access.canViewExpense) {
    clauses.push({
      NOT: {
        type: "filing",
        title: { startsWith: EXPENSE_ACTIVITY_TITLE_PREFIX },
      },
    });
  }
  return clauses;
}

/** The current viewer's money access (cached per request by the
 *  underlying permission checks). */
export async function resolveActivityMoneyAccess(): Promise<ActivityMoneyAccess> {
  const [canViewSettlement, canViewExpense, canViewBilling] = await Promise.all([
    currentUserHasPermission("matters.settlement.view"),
    currentUserHasPermission("matters.expense.view"),
    currentUserHasPermission("billing.view"),
  ]);
  return { canViewSettlement, canViewExpense, canViewBilling };
}
