/**
 * Expense constants — shared between server actions, client forms,
 * and read-side components. Lives outside the `"use server"`
 * actions file because that file can only export async functions.
 */

/// Free-string category list — matches the schema comment on
/// `Expense.category`. Adding a new category is a UI change only,
/// not a migration.
export const EXPENSE_CATEGORIES = [
  "filing_fee",
  "expert",
  "travel",
  "deposition",
  "medical_record",
  "postage",
  "records",
  "research",
  "other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  filing_fee: "Filing fee",
  expert: "Expert witness",
  travel: "Travel",
  deposition: "Deposition transcript",
  medical_record: "Medical records",
  postage: "Postage / shipping",
  records: "Records retrieval",
  research: "Research",
  other: "Other",
};

export type ExpenseFormState = {
  status: "idle" | "ok" | "error";
  errors?: Record<string, string[]>;
  error?: string;
};

export const expenseInitialState: ExpenseFormState = { status: "idle" };
