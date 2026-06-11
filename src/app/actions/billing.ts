/**
 * Billing server actions — invoices + trust ledger.
 *
 * V1 covers what a solo attorney needs to actually bill a client:
 *   - Generate an invoice from WIP time (one click → draft invoice)
 *   - Transition: draft → sent → paid (or void as the escape hatch)
 *   - Add manual trust deposits / disbursements / refunds (bumps
 *     `Matter.trustBalance` in the same transaction)
 *
 * Auth model: any signed-in firm member can perform these. Once
 * we have role-permission granularity, we'll gate "void invoice"
 * + "trust disbursement" behind a billing role; for v1 a solo
 * attorney + paralegal flow doesn't need that.
 *
 * Decimal correctness: every money operation goes through
 * `Prisma.Decimal` math (`.add()`, `.sub()`) so cents never drift.
 * Numbers from the form are parsed once into Decimal and round-
 * tripped through the DB.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma, type Tx } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { requirePermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import { createNotifications } from "@/lib/notifications";
import {
  invoiceStatusTransitions,
  canDeleteInvoice,
  canVoidInvoice,
  TRUST_TXN_TYPES,
  INVOICE_PAYMENT_SOURCES,
  billingInitialState,
  type BillingFormState,
  type InvoiceKind,
  type LineItemEditState,
} from "@/lib/billing-form";

// ── Helpers ─────────────────────────────────────────────────────────────

/** Generate the next invoice number for the current calendar year.
 *  Format: "YYYY-NNN" (e.g. 2026-007). Counts existing invoices
 *  whose number starts with the year prefix. Race condition path:
 *  if two concurrent generates land on the same number, the
 *  unique-index on Invoice.invoiceNumber rejects the second; the
 *  retry below catches the rare case. */
async function nextInvoiceNumber(
  tx: Tx
): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `${year}-`;
  const existing = await tx.invoice.findMany({
    where: { invoiceNumber: { startsWith: prefix } },
    select: { invoiceNumber: true },
  });
  // Strip prefix, parse number, find max. Defensive against any
  // hand-crafted invoice numbers that don't match the pattern.
  let max = 0;
  for (const inv of existing) {
    const tail = inv.invoiceNumber.slice(prefix.length);
    const n = parseInt(tail, 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

/** Mutation helper — adjusts a matter's trustBalance by the signed
 *  delta. Decimal-safe; refuses to overdraw. Caller is expected to
 *  also create the underlying TrustTransaction row. */
async function adjustTrustBalance(
  tx: Tx,
  matterId: string,
  deltaDecimal: Prisma.Decimal
): Promise<{ ok: boolean; error?: string }> {
  const m = await tx.matter.findUnique({
    where: { id: matterId },
    select: { trustBalance: true },
  });
  if (!m) return { ok: false, error: "Matter not found" };
  const next = m.trustBalance.add(deltaDecimal);
  if (next.isNegative()) {
    return {
      ok: false,
      error: `Trust would overdraw — current balance is $${m.trustBalance.toFixed(2)}, attempted change ${deltaDecimal.toFixed(2)}.`,
    };
  }
  await tx.matter.update({
    where: { id: matterId },
    data: { trustBalance: next },
  });
  return { ok: true };
}

// ── Generate invoice from WIP ───────────────────────────────────────────

const generateSchema = z.object({
  /** Days from issueDate until dueDate. 30 by default — overridable
   *  per generate. */
  dueDays: z
    .string()
    .optional()
    .default("30")
    .transform((v) => {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 0 || n > 365) return 30;
      return n;
    }),
  /** Optional notes attached to the invoice (appears on the row). */
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export async function generateInvoiceFromWip(
  matterId: string,
  _prev: BillingFormState,
  formData: FormData
): Promise<BillingFormState> {
  const userId = await getCurrentUserId();
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = generateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      error: "Invalid form input.",
    };
  }

  // Single transaction: lock the WIP rows in, compute total, mint
  // the invoice, attach the rows, flip their status. If any step
  // fails the whole thing rolls back — no half-billed entries.
  try {
    const result = await prisma.$transaction(async (tx) => {
      const matter = await tx.matter.findUnique({
        where: { id: matterId },
        select: { id: true, name: true, clientId: true },
      });
      if (!matter) throw new Error("Matter not found");

      // Re-pull WIP entries inside the transaction so we don't bill
      // a row a second clock-tick. Only billable + uncharged + un-
      // invoiced + non-billed-status rows count.
      const entries = await tx.timeEntry.findMany({
        where: {
          matterId: matter.id,
          billable: true,
          noCharge: false,
          invoiceId: null,
          status: { in: ["draft", "submitted", "billable"] },
        },
        select: { id: true, amount: true },
      });

      // Same-shaped pull for billable + un-invoiced expenses on
      // the matter. Both buckets contribute to the invoice
      // subtotal; the bundling is a single transaction so an
      // expense linked to an invoice that fails to mint never
      // ends up in a half-billed state.
      const expenseRows = await tx.expense.findMany({
        where: {
          matterId: matter.id,
          billable: true,
          invoiceId: null,
        },
        select: { id: true, amount: true },
      });

      if (entries.length === 0 && expenseRows.length === 0) {
        throw new Error(
          "Nothing unbilled to invoice — log billable time or expenses first."
        );
      }

      const timeSubtotal = entries.reduce(
        (acc, e) => (e.amount ? acc.add(e.amount) : acc),
        new Prisma.Decimal(0)
      );
      const expenseSubtotal = expenseRows.reduce(
        (acc, e) => acc.add(e.amount),
        new Prisma.Decimal(0)
      );
      const subtotal = timeSubtotal.add(expenseSubtotal);
      // No tax for v1 — firm settings will introduce a per-state
      // rate later. Total = subtotal.
      const total = subtotal;

      const issueDate = new Date();
      const dueDate = new Date(
        issueDate.getTime() + parsed.data.dueDays * 24 * 60 * 60 * 1000
      );

      // Number generation + create. Retry once on the rare unique-
      // index collision (concurrent generate races).
      let invoice;
      for (let attempt = 0; attempt < 2; attempt++) {
        const number = await nextInvoiceNumber(tx);
        try {
          invoice = await tx.invoice.create({
            data: {
              invoiceNumber: number,
              matterId: matter.id,
              clientId: matter.clientId,
              issueDate,
              dueDate,
              subtotal,
              taxAmount: new Prisma.Decimal(0),
              totalAmount: total,
              paidAmount: new Prisma.Decimal(0),
              status: "draft",
              notes: parsed.data.notes || null,
            },
            select: { id: true, invoiceNumber: true },
          });
          break;
        } catch (err) {
          // P2002 = unique constraint. Retry next() once.
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === "P2002" &&
            attempt === 0
          ) {
            continue;
          }
          throw err;
        }
      }
      if (!invoice) throw new Error("Failed to mint invoice number.");

      // Link every WIP entry to this invoice + flip status to billed.
      if (entries.length > 0) {
        await tx.timeEntry.updateMany({
          where: { id: { in: entries.map((e) => e.id) } },
          data: { invoiceId: invoice.id, status: "billed" },
        });
      }
      // Link every billable expense to the invoice. Expenses
      // don't have a status enum like time entries — the
      // `invoiceId` itself is the "billed" signal.
      if (expenseRows.length > 0) {
        await tx.expense.updateMany({
          where: { id: { in: expenseRows.map((e) => e.id) } },
          data: { invoiceId: invoice.id },
        });
      }

      return {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        matter,
        entryCount: entries.length,
        expenseCount: expenseRows.length,
        total,
      };
    });

    // Activity log title spells out both buckets so the audit
    // makes the bundle's composition readable at a glance.
    const composition: string[] = [];
    if (result.entryCount > 0) {
      composition.push(
        `${result.entryCount} time ${result.entryCount === 1 ? "entry" : "entries"}`
      );
    }
    if (result.expenseCount > 0) {
      composition.push(
        `${result.expenseCount} expense${result.expenseCount === 1 ? "" : "s"}`
      );
    }
    await logActivity({
      matterId: result.matter.id,
      userId,
      type: "filing",
      title: `Invoice ${result.invoiceNumber} generated`,
      detail: `${composition.join(" + ")} · $${result.total.toFixed(2)}`,
    });

    revalidatePath(`/matters/${matterId}/billing`);
    revalidatePath(`/matters/${matterId}/time`);
    revalidatePath(`/matters/${matterId}`);
    revalidatePath("/", "layout"); // dashboard pulse aggregates change
    return {
      ...billingInitialState,
      status: "ok",
      invoiceId: result.invoiceId,
    };
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : "Couldn't generate invoice.",
    };
  }
}

// ── Invoice line-item editing (un-sent invoices only) ──────────────────
//
// Editing a line item directly mutates the underlying TimeEntry row +
// re-derives the invoice's subtotal / total in the same transaction.
// Only allowed while the invoice is still in the firm's possession
// — `draft` or `approved`. Once `sent`, the client has the doc; in-
// place edits would diverge from what they received and break the
// audit trail. Void + regenerate is the right path then.
//
// Permission model mirrors the standalone `updateTimeEntry`: the
// entry's author can always edit their own; other actors need
// `time_entries.edit_any`. Admins short-circuit either path.

const editableInvoiceStatuses = new Set(["draft", "approved"]);

const updateLineItemSchema = z.object({
  date: z.string().min(1, "Date is required"),
  activity: z.string().trim().min(1, "Activity is required").max(200),
  narrative: z.string().max(4000).optional().or(z.literal("")),
  hours: z
    .string()
    .min(1, "Hours required")
    .refine((v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 && n <= 24;
    }, "Hours must be > 0 and ≤ 24"),
  /** Optional. Empty string = leave unchanged (contingent /
   *  no-rate matters). Set to a positive number to override. */
  rate: z
    .string()
    .optional()
    .or(z.literal(""))
    .refine(
      (v) => v === undefined || v === "" || Number.isFinite(Number(v)),
      "Rate must be a number"
    ),
});

export async function updateInvoiceLineItem(
  timeEntryId: string,
  _prev: LineItemEditState,
  formData: FormData
): Promise<LineItemEditState> {
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = updateLineItemSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const entry = await prisma.timeEntry.findUnique({
    where: { id: timeEntryId },
    select: {
      id: true,
      userId: true,
      matterId: true,
      invoiceId: true,
      status: true,
      invoice: { select: { id: true, status: true } },
    },
  });
  if (!entry) {
    return { status: "error", error: "Time entry not found." };
  }
  if (!entry.invoice) {
    return {
      status: "error",
      error:
        "This entry isn't on an invoice. Use the standard time-entry edit instead.",
    };
  }
  if (!editableInvoiceStatuses.has(entry.invoice.status)) {
    return {
      status: "error",
      error: `Invoice is ${entry.invoice.status}. Line items can only be edited on draft or approved invoices.`,
    };
  }

  // Author bypass; otherwise gate on time_entries.edit_any. Same
  // posture as the standalone updateTimeEntry action.
  const actorId = await getCurrentUserId();
  if (entry.userId !== actorId) {
    await requirePermission("time_entries.edit_any");
  }

  // Rate handling: empty string = preserve nothing changed (the row
  // had no rate, e.g. a contingent matter, and the user didn't try
  // to add one). Non-empty = parse + use.
  const newRate =
    parsed.data.rate && parsed.data.rate.length > 0
      ? new Prisma.Decimal(parsed.data.rate)
      : null;
  const newHours = Number(parsed.data.hours);
  // Amount = hours * rate when both are present. When rate is null,
  // amount is null too — the entry sits on the invoice but doesn't
  // contribute to the subtotal (matches the existing
  // generateInvoiceFromWip path that filters `e.amount ? ...` in
  // the reduce).
  const newAmount = newRate ? newRate.mul(newHours) : null;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.timeEntry.update({
        where: { id: entry.id },
        data: {
          date: new Date(parsed.data.date),
          activity: parsed.data.activity,
          narrative: parsed.data.narrative || null,
          hours: newHours,
          rate: newRate,
          amount: newAmount,
        },
      });
      // Recompute the invoice subtotal from scratch — pull every
      // line item (time + expense) again so the math stays
      // authoritative regardless of what changed. Cheaper than
      // tracking deltas; line counts on a typical invoice are
      // small (dozens, not thousands).
      const [timeEntries, expenses] = await Promise.all([
        tx.timeEntry.findMany({
          where: { invoiceId: entry.invoice!.id },
          select: { amount: true },
        }),
        tx.expense.findMany({
          where: { invoiceId: entry.invoice!.id },
          select: { amount: true },
        }),
      ]);
      const timeSubtotal = timeEntries.reduce(
        (acc, e) => (e.amount ? acc.add(e.amount) : acc),
        new Prisma.Decimal(0)
      );
      const expenseSubtotal = expenses.reduce(
        (acc, e) => acc.add(e.amount),
        new Prisma.Decimal(0)
      );
      const subtotal = timeSubtotal.add(expenseSubtotal);
      // No tax in v1 — total = subtotal. Mirrors generateInvoiceFromWip.
      await tx.invoice.update({
        where: { id: entry.invoice!.id },
        data: { subtotal, totalAmount: subtotal },
      });
    });

    revalidatePath(`/matters/${entry.matterId}/billing`);
    revalidatePath(`/matters/${entry.matterId}`);
    return { status: "ok" };
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : "Couldn't update line item.",
    };
  }
}

// ── Invoice status transitions ──────────────────────────────────────────

export async function setInvoiceStatus(
  invoiceId: string,
  next: string
): Promise<{ ok: boolean; error?: string }> {
  const userId = await getCurrentUserId();
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      matterId: true,
      invoiceNumber: true,
      kind: true,
      status: true,
      totalAmount: true,
      paidAmount: true,
    },
  });
  if (!invoice) return { ok: false, error: "Invoice not found." };

  const kind = invoice.kind as InvoiceKind;
  const allowed = invoiceStatusTransitions(invoice.status, kind);
  if (!allowed.includes(next)) {
    return {
      ok: false,
      error: `Can't transition ${invoice.status} → ${next}.`,
    };
  }

  // Defense-in-depth: void is refused once any payment has landed,
  // even if the state-machine technically allows the string. This
  // catches the data-drift case where an old row sits in 'sent'
  // with paidAmount > 0 (pre-refactor schema).
  if (next === "void") {
    const paidNum = invoice.paidAmount.toNumber();
    if (!canVoidInvoice(invoice.status, paidNum, kind)) {
      return {
        ok: false,
        error:
          "Can't void an invoice with payments recorded — refund the payments first.",
      };
    }
  }

  // Internal records' "Mark recorded" path is the only remaining
  // place setInvoiceStatus sets paidAmount directly. Client-invoice
  // payments are funneled through recordInvoicePayment so every
  // status flip is paired with a real payment row.
  const data: Prisma.InvoiceUpdateInput =
    next === "paid" && kind === "internal_record"
      ? { status: next, paidAmount: invoice.totalAmount }
      : { status: next };

  if (next === "void") {
    // Void → unlink time entries so they go back into WIP under
    // their original status, and unlink expenses so they're
    // available to roll into a future invoice. Otherwise
    // voiding strands billable hours at status="billed" and
    // expenses pinned to a now-voided invoice.
    await prisma.$transaction([
      prisma.timeEntry.updateMany({
        where: { invoiceId: invoice.id },
        data: { invoiceId: null, status: "billable" },
      }),
      prisma.expense.updateMany({
        where: { invoiceId: invoice.id },
        data: { invoiceId: null },
      }),
      prisma.invoice.update({ where: { id: invoice.id }, data }),
    ]);
  } else {
    await prisma.invoice.update({ where: { id: invoice.id }, data });
  }

  await logActivity({
    matterId: invoice.matterId,
    userId,
    type: "filing",
    title: `Invoice ${invoice.invoiceNumber} → ${next}`,
  });

  revalidatePath(`/matters/${invoice.matterId}/billing`);
  revalidatePath(`/matters/${invoice.matterId}/time`);
  revalidatePath(`/matters/${invoice.matterId}`);
  revalidatePath("/", "layout");
  return { ok: true };
}

// ── Delete draft invoice ───────────────────────────────────────────────
//
// Hard-deletes a draft client invoice. Drafts are pre-AR — no one
// has seen the doc, nothing's been paid against it — so removing
// the row entirely is the right shape, vs. void (which is a
// soft-kill that preserves the audit trail for sent / approved
// docs). Time entries linked to the draft return to billable WIP
// just like the void path.
//
// Refused on: anything that isn't a client draft, anything with
// paidAmount > 0 (defense-in-depth — drafts shouldn't have
// payments, but the guard catches data drift).

export async function deleteInvoice(
  invoiceId: string
): Promise<{ ok: boolean; error?: string }> {
  const userId = await getCurrentUserId();
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      matterId: true,
      invoiceNumber: true,
      kind: true,
      status: true,
      paidAmount: true,
    },
  });
  if (!invoice) return { ok: false, error: "Invoice not found." };

  const paidNum = invoice.paidAmount.toNumber();
  if (
    !canDeleteInvoice(invoice.status, paidNum, invoice.kind as InvoiceKind)
  ) {
    return {
      ok: false,
      error:
        "Only draft client invoices with no recorded payments can be deleted. Use Void on sent or approved invoices.",
    };
  }

  // Two-step: unlink + reset entries first so they re-appear in
  // WIP, then delete the row. The Invoice → InvoicePayment cascade
  // handles any stray payment rows (drafts shouldn't have any
  // anyway), and the TimeEntry → Invoice SetNull would handle the
  // unlink for free, but we want status: "billable" too — SetNull
  // alone leaves status="billed".
  await prisma.$transaction([
    prisma.timeEntry.updateMany({
      where: { invoiceId: invoice.id },
      data: { invoiceId: null, status: "billable" },
    }),
    prisma.invoice.delete({ where: { id: invoice.id } }),
  ]);

  await logActivity({
    matterId: invoice.matterId,
    userId,
    type: "filing",
    title: `Draft invoice ${invoice.invoiceNumber} deleted`,
  });

  revalidatePath(`/matters/${invoice.matterId}/billing`);
  revalidatePath(`/matters/${invoice.matterId}/time`);
  revalidatePath(`/matters/${invoice.matterId}`);
  revalidatePath("/", "layout");
  return { ok: true };
}

// ── Approve invoice ────────────────────────────────────────────────────
//
// Single-step transition draft → approved. Today this is just a
// status flip; future iterations will gate it behind a billing-
// approval role and capture the approver in an audit row.

export async function approveInvoice(
  invoiceId: string
): Promise<{ ok: boolean; error?: string }> {
  const userId = await getCurrentUserId();
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      matterId: true,
      invoiceNumber: true,
      kind: true,
      status: true,
    },
  });
  if (!invoice) return { ok: false, error: "Invoice not found." };
  if (invoice.kind !== "client") {
    return { ok: false, error: "Only client invoices need approval." };
  }
  if (invoice.status !== "draft") {
    return {
      ok: false,
      error: `Approve only applies to draft invoices (this one is ${invoice.status}).`,
    };
  }

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { status: "approved" },
  });

  await logActivity({
    matterId: invoice.matterId,
    userId,
    type: "filing",
    title: `Invoice ${invoice.invoiceNumber} approved`,
  });

  revalidatePath(`/matters/${invoice.matterId}/billing`);
  revalidatePath(`/matters/${invoice.matterId}`);
  revalidatePath("/", "layout");
  return { ok: true };
}

// ── Trust ledger ────────────────────────────────────────────────────────

const trustTxnSchema = z.object({
  type: z.enum(TRUST_TXN_TYPES),
  /** Form posts a string — accept "$1,234.56" or "1234.56" and
   *  validate ≥ 0.01. Sign is applied by `type` (deposit positive,
   *  disbursement / refund negative). */
  amount: z
    .string()
    .trim()
    .min(1, "Amount is required")
    .transform((v) => v.replace(/[$,]/g, ""))
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), "Enter a valid amount")
    .refine((v) => parseFloat(v) > 0, "Amount must be greater than 0"),
  description: z.string().trim().min(1, "Description is required").max(400),
  reference: z.string().trim().max(120).optional().or(z.literal("")),
  /** YYYY-MM-DD from <input type="date">. Defaults to today when
   *  empty. */
  date: z.string().optional().or(z.literal("")),
});

export async function addTrustTransaction(
  matterId: string,
  _prev: BillingFormState,
  formData: FormData
): Promise<BillingFormState> {
  const userId = await getCurrentUserId();
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = trustTxnSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;
  const positive = new Prisma.Decimal(data.amount);
  // Disbursement / refund are stored as negative amounts so trust
  // sums match the balance directly. Deposits stay positive.
  const signed =
    data.type === "deposit" ? positive : positive.neg();

  try {
    const result = await prisma.$transaction(async (tx) => {
      const balanceCheck = await adjustTrustBalance(tx, matterId, signed);
      if (!balanceCheck.ok) throw new Error(balanceCheck.error);
      const txnDate = data.date ? new Date(data.date) : new Date();
      const txn = await tx.trustTransaction.create({
        data: {
          matterId,
          type: data.type,
          amount: signed,
          description: data.description,
          reference: data.reference || null,
          date: txnDate,
          createdBy: userId,
        },
        select: { id: true },
      });
      return { id: txn.id };
    });

    await logActivity({
      matterId,
      userId,
      type: "deposit",
      title:
        data.type === "deposit"
          ? `Trust deposit · $${positive.toFixed(2)}`
          : `Trust ${data.type} · $${positive.toFixed(2)}`,
      detail: data.description,
    });

    revalidatePath(`/matters/${matterId}/billing`);
    revalidatePath(`/matters/${matterId}`);
    revalidatePath("/", "layout");
    return {
      ...billingInitialState,
      status: "ok",
      // Re-using invoiceId to mean "the row that was created" is a
      // tiny abuse of the field; the page doesn't use it for trust
      // txns yet. Leave the field unset.
    };
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : "Couldn't record transaction.",
    };
  }
}

// ── Bundle as internal record ──────────────────────────────────────────
//
// Same WIP-bundling mechanic as generateInvoiceFromWip, but the
// resulting Invoice row is born already-locked at status="paid" with
// kind="internal_record". No due date math (issueDate == dueDate),
// no AR exposure (excluded from Outstanding-AR aggregates by the
// query layer). Used to close out unbilled time on contingency /
// pro-bono cases that resolve without a fee petition — settled,
// fee already collected via a separate channel, etc.
//
// Void still works: unlinks entries back to billable WIP, same as
// the client-invoice path.

const internalRecordSchema = z.object({
  /** Required-ish reason captured into Invoice.notes — answers
   *  "why are these entries being closed without billing?".
   *  Free-text so the firm can land on its own conventions
   *  (settled, abandoned, pro-bono complete, fee already collected
   *  via settlement, etc.). */
  notes: z
    .string()
    .trim()
    .min(1, "Reason is required so the record explains itself")
    .max(2000),
});

export async function bundleAsInternalRecord(
  matterId: string,
  _prev: BillingFormState,
  formData: FormData
): Promise<BillingFormState> {
  const userId = await getCurrentUserId();
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = internalRecordSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const matter = await tx.matter.findUnique({
        where: { id: matterId },
        select: { id: true, name: true, clientId: true },
      });
      if (!matter) throw new Error("Matter not found");

      const entries = await tx.timeEntry.findMany({
        where: {
          matterId: matter.id,
          billable: true,
          noCharge: false,
          invoiceId: null,
          status: { in: ["draft", "submitted", "billable"] },
        },
        select: { id: true, amount: true },
      });
      // Bundle billable + un-invoiced expenses too — internal-
      // record close-out should sweep both buckets so the WIP +
      // expense rails on the matter Time tab read empty after
      // the bundle.
      const expenseRows = await tx.expense.findMany({
        where: {
          matterId: matter.id,
          billable: true,
          invoiceId: null,
        },
        select: { id: true, amount: true },
      });
      if (entries.length === 0 && expenseRows.length === 0) {
        throw new Error("Nothing unbilled to bundle.");
      }

      const timeSubtotal = entries.reduce(
        (acc, e) => (e.amount ? acc.add(e.amount) : acc),
        new Prisma.Decimal(0)
      );
      const expenseSubtotal = expenseRows.reduce(
        (acc, e) => acc.add(e.amount),
        new Prisma.Decimal(0)
      );
      const subtotal = timeSubtotal.add(expenseSubtotal);
      const total = subtotal;

      const issueDate = new Date();

      let invoice;
      for (let attempt = 0; attempt < 2; attempt++) {
        const number = await nextInvoiceNumber(tx);
        try {
          invoice = await tx.invoice.create({
            data: {
              invoiceNumber: number,
              matterId: matter.id,
              clientId: matter.clientId,
              kind: "internal_record",
              issueDate,
              // No real due date — set equal to issue so daysUntilDue
              // math doesn't surface anything alarming.
              dueDate: issueDate,
              subtotal,
              taxAmount: new Prisma.Decimal(0),
              totalAmount: total,
              // Born already-locked as "Recorded" (status=paid, label
              // flipped per kind). Avoids the "draft sitting there
              // forever" fate of internal records.
              paidAmount: total,
              status: "paid",
              notes: parsed.data.notes,
            },
            select: { id: true, invoiceNumber: true },
          });
          break;
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === "P2002" &&
            attempt === 0
          ) {
            continue;
          }
          throw err;
        }
      }
      if (!invoice) throw new Error("Failed to mint record number.");

      // Same as client invoices — flip the entries to "billed" so
      // they leave WIP. Void unlinks them back. The "billed" status
      // here doesn't mean "billed to a client"; it means "linked to
      // a bundling document, no longer in WIP".
      if (entries.length > 0) {
        await tx.timeEntry.updateMany({
          where: { id: { in: entries.map((e) => e.id) } },
          data: { invoiceId: invoice.id, status: "billed" },
        });
      }
      if (expenseRows.length > 0) {
        await tx.expense.updateMany({
          where: { id: { in: expenseRows.map((e) => e.id) } },
          data: { invoiceId: invoice.id },
        });
      }

      return {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        matter,
        entryCount: entries.length,
        total,
      };
    });

    await logActivity({
      matterId: result.matter.id,
      userId,
      type: "filing",
      title: `Internal record ${result.invoiceNumber} bundled`,
      detail: `${result.entryCount} time entries · $${result.total.toFixed(2)} (${parsed.data.notes})`,
    });

    revalidatePath(`/matters/${matterId}/billing`);
    revalidatePath(`/matters/${matterId}/time`);
    revalidatePath(`/matters/${matterId}`);
    revalidatePath("/", "layout");
    return {
      ...billingInitialState,
      status: "ok",
      invoiceId: result.invoiceId,
    };
  } catch (err) {
    return {
      status: "error",
      error:
        err instanceof Error ? err.message : "Couldn't bundle internal record.",
    };
  }
}

// ── Record invoice payment (any channel) ───────────────────────────────
//
// The unified write path for "money landed against this invoice."
// Trust, check, ACH, cash, card, other — all flow through here.
//
// What the action does:
//   - Validates the invoice is in a payable state (sent / partial,
//     client kind only).
//   - When source=trust: also writes a TrustTransaction (trust
//     ledger leg) and decrements Matter.trustBalance, refusing if
//     trust would overdraw. Same atomic four-leg op the standalone
//     Pay-from-trust used to do — folded in here so callers don't
//     have to branch.
//   - Creates the canonical InvoicePayment row.
//   - Bumps Invoice.paidAmount and flips status: paid when fully
//     covered, partial otherwise.

const recordPaymentSchema = z.object({
  amount: z
    .string()
    .trim()
    .min(1, "Amount is required")
    .transform((v) => v.replace(/[$,]/g, ""))
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), "Enter a valid amount")
    .refine((v) => parseFloat(v) > 0, "Amount must be greater than 0"),
  /** YYYY-MM-DD; today when empty. Editable so reconciliation
   *  against bank statements is straightforward. */
  date: z.string().optional().or(z.literal("")),
  /** Channel the payment came in on. */
  source: z.enum(INVOICE_PAYMENT_SOURCES),
  reference: z.string().trim().max(120).optional().or(z.literal("")),
  description: z.string().trim().max(400).optional().or(z.literal("")),
  /** When the lawyer ticks the "Send updated invoice" checkbox in
   *  the dialog, we send a refreshed copy of the invoice to the
   *  client showing the new payment activity. Today this is just
   *  a logged event (mirrors sendInvoice); when real email is
   *  wired up the same flag will fire the actual send. The future
   *  automatic-payment portal will call this action with
   *  notifyClient unset / false — its own confirmation flow
   *  handles client comms. */
  notifyClient: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "on"),
});

export async function recordInvoicePayment(
  invoiceId: string,
  _prev: BillingFormState,
  formData: FormData
): Promise<BillingFormState> {
  const userId = await getCurrentUserId();
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = recordPaymentSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;
  const requested = new Prisma.Decimal(data.amount);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
        select: {
          id: true,
          matterId: true,
          invoiceNumber: true,
          kind: true,
          status: true,
          totalAmount: true,
          paidAmount: true,
          // Pull the client's email so the notifyClient branch can
          // address the resend. Single source of truth — never
          // accept the recipient from form input on this path
          // (that's how a phished form would exfiltrate to a
          // wrong address).
          matter: { select: { client: { select: { email: true } } } },
        },
      });
      if (!invoice) throw new Error("Invoice not found.");
      if (invoice.kind !== "client") {
        throw new Error(
          "Payments only apply to client invoices — internal records have no AR balance."
        );
      }
      if (invoice.status !== "sent" && invoice.status !== "partial") {
        throw new Error(
          `Payments are only recordable on sent or partially-paid invoices (this one is ${invoice.status}). Approve and send the invoice first.`
        );
      }

      const balance = invoice.totalAmount.sub(invoice.paidAmount);
      if (balance.lessThanOrEqualTo(0)) {
        throw new Error("Invoice has no outstanding balance.");
      }
      if (requested.greaterThan(balance)) {
        throw new Error(
          `Amount exceeds the invoice's $${balance.toFixed(2)} balance — record the balance or less.`
        );
      }

      const txnDate = data.date ? new Date(data.date) : new Date();

      // Trust path: write the trust ledger leg + decrement the
      // matter trust balance, refusing on overdraw. The InvoicePayment
      // row links back to the TrustTransaction for cross-navigation.
      let trustTxnId: string | null = null;
      if (data.source === "trust") {
        const matter = await tx.matter.findUnique({
          where: { id: invoice.matterId },
          select: { trustBalance: true },
        });
        if (!matter) throw new Error("Matter not found.");
        if (requested.greaterThan(matter.trustBalance)) {
          throw new Error(
            `Trust balance is $${matter.trustBalance.toFixed(2)} — not enough to cover $${requested.toFixed(2)}.`
          );
        }
        const trustTxn = await tx.trustTransaction.create({
          data: {
            matterId: invoice.matterId,
            type: "disbursement",
            amount: requested.neg(),
            description: `Payment to invoice ${invoice.invoiceNumber}`,
            reference: data.reference || null,
            date: txnDate,
            createdBy: userId,
            invoiceId: invoice.id,
          },
          select: { id: true },
        });
        trustTxnId = trustTxn.id;
        await tx.matter.update({
          where: { id: invoice.matterId },
          data: { trustBalance: matter.trustBalance.sub(requested) },
        });
      }

      await tx.invoicePayment.create({
        data: {
          invoiceId: invoice.id,
          source: data.source,
          amount: requested,
          date: txnDate,
          description: data.description || null,
          reference: data.reference || null,
          trustTxnId,
          createdBy: userId,
        },
      });

      const newPaid = invoice.paidAmount.add(requested);
      const fullyPaid = newPaid.greaterThanOrEqualTo(invoice.totalAmount);
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          paidAmount: newPaid,
          status: fullyPaid ? "paid" : "partial",
        },
      });

      return {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        matterId: invoice.matterId,
        amount: requested,
        fullyPaid,
        source: data.source,
        clientEmail: invoice.matter.client?.email ?? null,
      };
    });

    await logActivity({
      matterId: result.matterId,
      userId,
      type: "deposit",
      title: result.fullyPaid
        ? `Invoice ${result.invoiceNumber} paid in full · $${result.amount.toFixed(2)} (${result.source})`
        : `Partial payment to invoice ${result.invoiceNumber} · $${result.amount.toFixed(2)} (${result.source})`,
    });

    // Notify client of the updated invoice. Today this is logged-
    // only — when real email lands the same flag fires actual
    // delivery. Skip silently if the client has no email on file
    // rather than failing the action: the payment itself still
    // landed correctly.
    if (data.notifyClient && result.clientEmail) {
      await logActivity({
        matterId: result.matterId,
        userId,
        type: "filing",
        title: `Updated invoice ${result.invoiceNumber} sent to ${result.clientEmail}`,
        detail: `after $${result.amount.toFixed(2)} ${result.source} payment`,
      });
    }

    // Fan a payment-recorded notification out to the matter's
    // active team — case leads + co-counsel typically want to
    // know money landed. Skips the actor (no point pinging your
    // own bell). Best-effort: failures don't roll back the
    // payment.
    const team = await prisma.matterTeamMember.findMany({
      where: { matterId: result.matterId, removedAt: null },
      select: { userId: true },
    });
    const recipients = team
      .map((t) => t.userId)
      .filter((id) => id !== userId);
    if (recipients.length > 0) {
      const matter = await prisma.matter.findUnique({
        where: { id: result.matterId },
        select: { name: true },
      });
      await createNotifications(recipients, {
        type: "invoice_payment_recorded",
        title: `$${result.amount.toFixed(2)} payment on ${result.invoiceNumber}`,
        body: `${matter?.name ?? "Matter"} · ${result.source}`,
        link: `/matters/${result.matterId}/billing?invoice=${result.invoiceId}`,
        matterId: result.matterId,
      });
    }

    revalidatePath(`/matters/${result.matterId}/billing`);
    revalidatePath(`/matters/${result.matterId}`);
    revalidatePath("/", "layout");
    return { ...billingInitialState, status: "ok" };
  } catch (err) {
    return {
      status: "error",
      error:
        err instanceof Error ? err.message : "Couldn't record the payment.",
    };
  }
}

// ── Send invoice (with optional trust application) ─────────────────────
//
// Transitions an approved invoice to sent. For now "sending" is just
// a logged event — Gmail integration + US-mail print/ship workflow
// land later. The dialog captures the channel, the recipient
// address, and (optionally) an amount of trust to apply against the
// invoice in the same transaction.
//
// If applyTrust is set, we run the same four-leg op as the trust
// payment branch of recordInvoicePayment — and the resulting status
// can be sent / partial / paid depending on coverage.

const sendInvoiceSchema = z.object({
  /** "email" today; "mail" is reserved for the future US-mail
   *  workflow but rejected here so the dialog's disabled state is
   *  enforced server-side too. */
  method: z.enum(["email", "mail"]),
  /** Recipient — for email, validated as an email address. For
   *  mail, will become the bill-to mailing address (pulled from
   *  the client) once that path lands. */
  recipient: z.string().trim().min(1, "Recipient is required").max(320),
  /** "true" when the apply-trust checkbox was ticked. */
  applyTrust: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "on"),
  /** Amount of trust to apply, only consulted when applyTrust=true.
   *  Defaults to MIN(trust balance, invoice balance) on the client. */
  trustAmount: z
    .string()
    .optional()
    .or(z.literal("")),
});

export async function sendInvoice(
  invoiceId: string,
  _prev: BillingFormState,
  formData: FormData
): Promise<BillingFormState> {
  const userId = await getCurrentUserId();
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = sendInvoiceSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;
  if (data.method === "mail") {
    return {
      status: "error",
      error: "US mail isn't wired up yet — pick email for now.",
    };
  }
  if (data.method === "email" && !/^.+@.+\..+$/.test(data.recipient)) {
    return {
      status: "error",
      errors: { recipient: ["Enter a valid email address."] },
    };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
        select: {
          id: true,
          matterId: true,
          invoiceNumber: true,
          kind: true,
          status: true,
          totalAmount: true,
          paidAmount: true,
        },
      });
      if (!invoice) throw new Error("Invoice not found.");
      if (invoice.kind !== "client") {
        throw new Error("Only client invoices get sent.");
      }
      if (invoice.status !== "approved") {
        throw new Error(
          `Send is only available on approved invoices (this one is ${invoice.status}). Approve it first.`
        );
      }

      // Optional apply-trust leg. Same shape as recordInvoicePayment's
      // trust branch — if it would overdraw the invoice or trust, the
      // whole transaction rolls back and the invoice doesn't move.
      let trustApplied: Prisma.Decimal | null = null;
      let newPaid = invoice.paidAmount;
      if (data.applyTrust) {
        const matter = await tx.matter.findUnique({
          where: { id: invoice.matterId },
          select: { trustBalance: true },
        });
        if (!matter) throw new Error("Matter not found.");
        const balance = invoice.totalAmount.sub(invoice.paidAmount);
        // Default: cap at MIN(trust, balance). User-supplied amount
        // can step down but never up past the cap.
        const cap = matter.trustBalance.lessThan(balance)
          ? matter.trustBalance
          : balance;
        const applied = data.trustAmount
          ? new Prisma.Decimal(data.trustAmount.replace(/[$,]/g, ""))
          : cap;
        if (applied.lessThanOrEqualTo(0)) {
          throw new Error("Trust application amount must be greater than 0.");
        }
        if (applied.greaterThan(cap)) {
          throw new Error(
            `Can apply at most $${cap.toFixed(2)} from trust (limited by ${
              matter.trustBalance.lessThan(balance) ? "trust balance" : "invoice balance"
            }).`
          );
        }
        const trustTxn = await tx.trustTransaction.create({
          data: {
            matterId: invoice.matterId,
            type: "disbursement",
            amount: applied.neg(),
            description: `Payment to invoice ${invoice.invoiceNumber}`,
            reference: null,
            date: new Date(),
            createdBy: userId,
            invoiceId: invoice.id,
          },
          select: { id: true },
        });
        await tx.matter.update({
          where: { id: invoice.matterId },
          data: { trustBalance: matter.trustBalance.sub(applied) },
        });
        await tx.invoicePayment.create({
          data: {
            invoiceId: invoice.id,
            source: "trust",
            amount: applied,
            date: new Date(),
            description: `Earned-fee transfer applied at invoice send`,
            reference: null,
            trustTxnId: trustTxn.id,
            createdBy: userId,
          },
        });
        newPaid = invoice.paidAmount.add(applied);
        trustApplied = applied;
      }

      // Final status: paid if trust covered the whole thing, partial
      // if it covered some, sent otherwise.
      const fullyPaid = newPaid.greaterThanOrEqualTo(invoice.totalAmount);
      const finalStatus = fullyPaid
        ? "paid"
        : trustApplied
          ? "partial"
          : "sent";
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          paidAmount: newPaid,
          status: finalStatus,
        },
      });

      return {
        invoiceNumber: invoice.invoiceNumber,
        matterId: invoice.matterId,
        method: data.method,
        recipient: data.recipient,
        trustApplied,
        finalStatus,
      };
    });

    // Log: send event + (separately) the trust application if it
    // happened. Two log lines so audit reads cleanly.
    await logActivity({
      matterId: result.matterId,
      userId,
      type: "filing",
      title: `Invoice ${result.invoiceNumber} sent via ${result.method}`,
      detail: `to ${result.recipient}`,
    });
    if (result.trustApplied) {
      await logActivity({
        matterId: result.matterId,
        userId,
        type: "deposit",
        title: `Trust applied to invoice ${result.invoiceNumber} · $${result.trustApplied.toFixed(2)}`,
      });
    }

    revalidatePath(`/matters/${result.matterId}/billing`);
    revalidatePath(`/matters/${result.matterId}`);
    revalidatePath("/", "layout");
    return { ...billingInitialState, status: "ok" };
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : "Couldn't send the invoice.",
    };
  }
}
