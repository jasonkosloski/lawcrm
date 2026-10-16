/**
 * ActivityLog title formats for expense mutations.
 *
 * Expense activity rows share the generic "filing" type, so the
 * matter Timeline can only tell them apart (and hide their amounts
 * from viewers without matters.expense.view) by the title prefix.
 * Both the writer (src/app/actions/expenses.ts) and the reader
 * (activityMoneyFilters in src/lib/queries/matter-detail.ts) go
 * through this module, so renaming one cannot silently reopen the
 * leak. Lives outside the "use server" actions file because that
 * file may only export async functions.
 */

/** A number or a Prisma Decimal. */
type Money = { toFixed(digits: number): string };

export const EXPENSE_ACTIVITY_TITLE_PREFIX = "Expense ";

export function expenseLoggedTitle(amount: Money, description: string) {
  return `${EXPENSE_ACTIVITY_TITLE_PREFIX}logged · $${amount.toFixed(2)} · ${description}`;
}

export function expenseEditedTitle(description: string) {
  return `${EXPENSE_ACTIVITY_TITLE_PREFIX}edited · ${description}`;
}

export function expenseDeletedTitle(amount: Money, description: string) {
  return `${EXPENSE_ACTIVITY_TITLE_PREFIX}deleted · $${amount.toFixed(2)} · ${description}`;
}
