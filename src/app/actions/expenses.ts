/**
 * Expense server actions.
 *
 * CRUD for matter-level out-of-pocket costs. Distinct from
 * TimeEntry — TimeEntry tracks the firm's labor; Expense tracks
 * actual money spent (filing fees, expert witness fees, deposition
 * transcripts, travel, postage, etc.).
 *
 * Permission gates per the granular catalog:
 *   - matters.expense.create   → log a new row
 *   - matters.expense.edit     → change fields after the fact
 *   - matters.expense.delete   → remove a row (refused once billed)
 *
 * The list-side `matters.expense.view` is enforced at the page
 * level only (the /matters/[id]/time expense section gates before
 * fetching) — the read-layer queries themselves do not check it,
 * so any new caller of getMatterExpenses must add its own guard.
 *
 * Decimal correctness throughout: amount is stored as Prisma
 * Decimal and round-tripped via `new Prisma.Decimal(...)`.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { assertChildMatterAccess, assertMatterAccess } from "@/lib/matter-access";
import { getCurrentUserId } from "@/lib/current-user";
import { logActivity } from "@/lib/activity-log";
import {
  expenseDeletedTitle,
  expenseEditedTitle,
  expenseLoggedTitle,
} from "@/lib/expense-activity";
// Expense.date is a date-only value (ADR-012): "YYYY-MM-DD" parses to
// UTC midnight and is read back in UTC — no time zone is ever applied.
import { parseDateOnly } from "@/lib/format-date";
import { requirePermission } from "@/lib/permission-check";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABEL,
  type ExpenseFormState,
} from "@/lib/expense-constants";

// Re-export NOT possible from a "use server" file — values exported
// here must be async functions. Anywhere a client wants the
// constants or initial state, import directly from
// `@/lib/expense-constants`.

const expenseSchema = z.object({
  date: z.string().trim().min(1, "Date is required"),
  description: z
    .string()
    .trim()
    .min(1, "Description is required")
    .max(400, "Description is too long"),
  category: z.enum(EXPENSE_CATEGORIES).default("other"),
  amount: z
    .string()
    .trim()
    .min(1, "Amount is required")
    .transform((v) => v.replace(/[$,]/g, ""))
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), "Enter a valid amount")
    .refine((v) => parseFloat(v) > 0, "Amount must be greater than 0"),
  utbmsCode: z.string().trim().max(20).optional().or(z.literal("")),
  billable: z.literal("on").optional(),
  clientAdvanced: z.literal("on").optional(),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  /** Optional FK to a Document row on the same matter — the
   *  receipt for this expense. We validate cross-matter isolation
   *  at write time so a tampered form can't link to another
   *  firm's documents. Empty string means "no receipt." */
  receiptDocumentId: z.string().optional().or(z.literal("")),
});

/** Validate the posted receipt-document FK against the matter
 *  scope. Empty/null maps to "no receipt"; an unknown id or
 *  cross-matter id silently coerces to null rather than blowing
 *  up the create. The dropdown is server-rendered from the
 *  matter's documents so a legitimate selection always resolves.
 *  Anything off that path probably came from a stale form or a
 *  tampered POST — drop it, don't error.
 *
 *  Empty string and null both map to "no receipt" — schema allows
 *  null, the form posts "" when the user picks "—". */
async function resolveReceiptDocumentId(
  matterId: string,
  posted: string | undefined
): Promise<string | null> {
  if (!posted) return null;
  const doc = await prisma.document.findUnique({
    where: { id: posted },
    select: { id: true, matterId: true },
  });
  if (!doc || doc.matterId !== matterId) return null;
  return doc.id;
}

const BILLED_EDIT_ERROR =
  "This expense has been billed on an invoice — void or edit the invoice first.";
const BILLED_DELETE_ERROR =
  "This expense has been billed on an invoice — void the invoice first if you need to remove the cost.";

/** A guarded write (`invoiceId: null`) matched nothing: work out
 *  whether the row was billed in the meantime or is simply gone. */
async function whyExpenseWriteFailed(
  expenseId: string,
  op: "edit" | "delete"
): Promise<string> {
  const row = await prisma.expense.findUnique({
    where: { id: expenseId },
    select: { invoiceId: true },
  });
  if (!row) return "Expense not found.";
  return op === "edit" ? BILLED_EDIT_ERROR : BILLED_DELETE_ERROR;
}

// ── Create ──────────────────────────────────────────────────────────────

export async function createExpense(
  matterId: string,
  _prev: ExpenseFormState,
  formData: FormData
): Promise<ExpenseFormState> {
  await requirePermission("matters.expense.create");
  await assertMatterAccess(matterId);
  const actorId = await getCurrentUserId();

  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = expenseSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  const matter = await prisma.matter.findUnique({
    where: { id: matterId },
    select: { id: true },
  });
  if (!matter) return { status: "error", error: "Matter not found." };

  // Cross-matter isolation guard for the receipt FK. Look up the
  // posted document and refuse if it lives on another matter.
  // Empty string is the "no receipt" sentinel.
  const receiptDocumentId = await resolveReceiptDocumentId(
    matter.id,
    data.receiptDocumentId
  );

  const date = parseDateOnly(data.date);
  if (!date) {
    return { status: "error", errors: { date: ["Invalid date"] } };
  }

  const expense = await prisma.expense.create({
    data: {
      matterId: matter.id,
      loggedBy: actorId,
      date,
      description: data.description,
      category: data.category,
      amount: new Prisma.Decimal(data.amount),
      utbmsCode: data.utbmsCode || null,
      billable: data.billable === "on",
      clientAdvanced: data.clientAdvanced === "on",
      notes: data.notes || null,
      receiptDocumentId,
    },
    select: { id: true, amount: true },
  });

  await logActivity({
    matterId: matter.id,
    userId: actorId,
    type: "filing",
    title: expenseLoggedTitle(expense.amount, data.description),
    detail: `Category: ${EXPENSE_CATEGORY_LABEL[data.category]}${data.clientAdvanced === "on" ? " · client-advanced" : ""}${data.billable !== "on" ? " · non-billable" : ""}`,
  });

  revalidatePath(`/matters/${matterId}/time`);
  revalidatePath(`/matters/${matterId}/billing`);
  revalidatePath(`/matters/${matterId}/timeline`);
  revalidatePath(`/matters/${matterId}`);
  revalidatePath("/", "layout");
  return { status: "ok" };
}

// ── Update ──────────────────────────────────────────────────────────────

export async function updateExpense(
  expenseId: string,
  _prev: ExpenseFormState,
  formData: FormData
): Promise<ExpenseFormState> {
  await requirePermission("matters.expense.edit");
  await assertChildMatterAccess("expense", expenseId);
  const actorId = await getCurrentUserId();

  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = expenseSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  const existing = await prisma.expense.findUnique({
    where: { id: expenseId },
    select: {
      id: true,
      matterId: true,
      invoiceId: true,
      amount: true,
      description: true,
    },
  });
  if (!existing) {
    return { status: "error", error: "Expense not found." };
  }
  // Refuse edits once the expense lives on an invoice — the
  // invoice's amounts would silently drift. Void/edit the invoice
  // first if a correction is needed.
  if (existing.invoiceId) {
    return { status: "error", error: BILLED_EDIT_ERROR };
  }

  const receiptDocumentId = await resolveReceiptDocumentId(
    existing.matterId,
    data.receiptDocumentId
  );

  const date = parseDateOnly(data.date);
  if (!date) {
    return { status: "error", errors: { date: ["Invalid date"] } };
  }

  // The `invoiceId: null` guard is part of the write itself: invoice
  // generation links expenses by id, and a check-then-write by id
  // alone would let an edit land on a row an invoice just claimed.
  const newAmount = new Prisma.Decimal(data.amount);
  const { count } = await prisma.expense.updateMany({
    where: { id: expenseId, invoiceId: null },
    data: {
      date,
      description: data.description,
      category: data.category,
      amount: newAmount,
      utbmsCode: data.utbmsCode || null,
      billable: data.billable === "on",
      clientAdvanced: data.clientAdvanced === "on",
      notes: data.notes || null,
      receiptDocumentId,
    },
  });
  if (count === 0) {
    return { status: "error", error: await whyExpenseWriteFailed(expenseId, "edit") };
  }

  await logActivity({
    matterId: existing.matterId,
    userId: actorId,
    type: "filing",
    title: expenseEditedTitle(data.description),
    detail: existing.amount.equals(newAmount)
      ? undefined
      : `Amount: $${existing.amount.toFixed(2)} → $${newAmount.toFixed(2)}`,
  });

  revalidatePath(`/matters/${existing.matterId}/time`);
  revalidatePath(`/matters/${existing.matterId}/billing`);
  revalidatePath(`/matters/${existing.matterId}/timeline`);
  return { status: "ok" };
}

// ── Delete ──────────────────────────────────────────────────────────────

export async function deleteExpense(
  expenseId: string
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("matters.expense.delete");
  await assertChildMatterAccess("expense", expenseId);
  const actorId = await getCurrentUserId();

  const existing = await prisma.expense.findUnique({
    where: { id: expenseId },
    select: {
      id: true,
      matterId: true,
      invoiceId: true,
      description: true,
      amount: true,
    },
  });
  if (!existing) return { ok: false, error: "Expense not found." };
  if (existing.invoiceId) {
    return { ok: false, error: BILLED_DELETE_ERROR };
  }

  // Guarded delete (see updateExpense): count 0 means an invoice
  // claimed the row — or someone else deleted it — since the read.
  const { count } = await prisma.expense.deleteMany({
    where: { id: existing.id, invoiceId: null },
  });
  if (count === 0) {
    return { ok: false, error: await whyExpenseWriteFailed(existing.id, "delete") };
  }

  await logActivity({
    matterId: existing.matterId,
    userId: actorId,
    type: "filing",
    title: expenseDeletedTitle(existing.amount, existing.description),
  });

  revalidatePath(`/matters/${existing.matterId}/time`);
  revalidatePath(`/matters/${existing.matterId}/billing`);
  revalidatePath(`/matters/${existing.matterId}/timeline`);
  return { ok: true };
}
