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
import { getCurrentUserId } from "@/lib/current-user";
import { logActivity } from "@/lib/activity-log";
// Date-only input ("YYYY-MM-DD") must parse to LOCAL midnight —
// `new Date(value)` reads it as UTC midnight, which drifts the
// expense a day early for anyone west of UTC. See parseLocalDate.
import { parseLocalDate } from "@/lib/format-date";
import { requirePermission } from "@/lib/permission-check";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABEL,
  expenseInitialState as _expenseInitialState,
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

// ── Create ──────────────────────────────────────────────────────────────

export async function createExpense(
  matterId: string,
  _prev: ExpenseFormState,
  formData: FormData
): Promise<ExpenseFormState> {
  await requirePermission("matters.expense.create");
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

  const date = parseLocalDate(data.date);
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
    title: `Expense logged · $${expense.amount.toFixed(2)} · ${data.description}`,
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
    select: { id: true, matterId: true, invoiceId: true },
  });
  if (!existing) {
    return { status: "error", error: "Expense not found." };
  }
  // Refuse edits once the expense lives on an invoice — the
  // invoice's amounts would silently drift. Void/edit the invoice
  // first if a correction is needed.
  if (existing.invoiceId) {
    return {
      status: "error",
      error:
        "This expense has been billed on an invoice — void or edit the invoice first.",
    };
  }

  const receiptDocumentId = await resolveReceiptDocumentId(
    existing.matterId,
    data.receiptDocumentId
  );

  const date = parseLocalDate(data.date);
  if (!date) {
    return { status: "error", errors: { date: ["Invalid date"] } };
  }

  await prisma.expense.update({
    where: { id: expenseId },
    data: {
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
  });

  await logActivity({
    matterId: existing.matterId,
    userId: actorId,
    type: "filing",
    title: `Expense edited · ${data.description}`,
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
    return {
      ok: false,
      error:
        "This expense has been billed on an invoice — void the invoice first if you need to remove the cost.",
    };
  }

  await prisma.expense.delete({ where: { id: existing.id } });

  await logActivity({
    matterId: existing.matterId,
    userId: actorId,
    type: "filing",
    title: `Expense deleted · $${existing.amount.toFixed(2)} · ${existing.description}`,
  });

  revalidatePath(`/matters/${existing.matterId}/time`);
  revalidatePath(`/matters/${existing.matterId}/billing`);
  revalidatePath(`/matters/${existing.matterId}/timeline`);
  return { ok: true };
}
