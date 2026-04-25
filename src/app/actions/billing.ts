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
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { logActivity } from "@/lib/activity-log";
import {
  invoiceStatusTransitions,
  TRUST_TXN_TYPES,
  billingInitialState,
  type BillingFormState,
  type InvoiceKind,
} from "@/lib/billing-form";

// ── Helpers ─────────────────────────────────────────────────────────────

/** Generate the next invoice number for the current calendar year.
 *  Format: "YYYY-NNN" (e.g. 2026-007). Counts existing invoices
 *  whose number starts with the year prefix. Race condition path:
 *  if two concurrent generates land on the same number, the
 *  unique-index on Invoice.invoiceNumber rejects the second; the
 *  retry below catches the rare case. */
async function nextInvoiceNumber(
  tx: Prisma.TransactionClient
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
  tx: Prisma.TransactionClient,
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
      if (entries.length === 0) {
        throw new Error("No unbilled entries to invoice.");
      }

      const subtotal = entries.reduce(
        (acc, e) => (e.amount ? acc.add(e.amount) : acc),
        new Prisma.Decimal(0)
      );
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
      await tx.timeEntry.updateMany({
        where: { id: { in: entries.map((e) => e.id) } },
        data: { invoiceId: invoice.id, status: "billed" },
      });

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
      type: "filing", // closest existing type — replace with "invoice" when ActivityType expands
      title: `Invoice ${result.invoiceNumber} generated`,
      detail: `${result.entryCount} time entries · $${result.total.toFixed(2)}`,
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

  // Kind-aware transition guard so internal records can't accidentally
  // be marked "sent" (which has no meaning for them).
  const allowed = invoiceStatusTransitions(
    invoice.status,
    invoice.kind as InvoiceKind
  );
  if (!allowed.includes(next)) {
    return {
      ok: false,
      error: `Can't transition ${invoice.status} → ${next}.`,
    };
  }

  // "Paid" implies paidAmount = totalAmount (full payment for v1;
  // partial payments land later with an explicit amount field).
  const data: Prisma.InvoiceUpdateInput =
    next === "paid"
      ? { status: next, paidAmount: invoice.totalAmount }
      : { status: next };

  if (next === "void") {
    // Void → unlink time entries so they go back into WIP under
    // their original status. Otherwise voiding strands billable
    // hours at status="billed".
    await prisma.$transaction([
      prisma.timeEntry.updateMany({
        where: { invoiceId: invoice.id },
        data: { invoiceId: null, status: "billable" },
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
      if (entries.length === 0) {
        throw new Error("No unbilled entries to bundle.");
      }

      const subtotal = entries.reduce(
        (acc, e) => (e.amount ? acc.add(e.amount) : acc),
        new Prisma.Decimal(0)
      );
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
      await tx.timeEntry.updateMany({
        where: { id: { in: entries.map((e) => e.id) } },
        data: { invoiceId: invoice.id, status: "billed" },
      });

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

// ── Pay invoice from trust ──────────────────────────────────────────────
//
// Atomic three-leg operation that mirrors what the lawyer is
// actually doing in real life: earned fees come out of the trust
// account, paid against the matter's outstanding invoice, and the
// trust ledger records the disbursement. All three legs land in
// one transaction — no partial drift if any step fails.
//
// Allows partial payments naturally: when trust < invoice.balance,
// the user can pay what's available; the invoice stays in its
// current open status with a non-zero paidAmount, and the Balance
// column shows what's still due. Marking fully-paid only flips
// status="paid" when paidAmount === totalAmount.
//
// Refused on internal records — they have no AR balance to pay
// (born already-locked at status="paid").

const trustPaymentSchema = z.object({
  /** Amount to pay from trust. Posted as a string from the form;
   *  validated as a positive Decimal-shaped value. */
  amount: z
    .string()
    .trim()
    .min(1, "Amount is required")
    .transform((v) => v.replace(/[$,]/g, ""))
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), "Enter a valid amount")
    .refine((v) => parseFloat(v) > 0, "Amount must be greater than 0"),
  /** YYYY-MM-DD; defaults to today when empty. Kept editable so
   *  back-dated entries are easy when reconciling against bank. */
  date: z.string().optional().or(z.literal("")),
  /** Optional check #, wire confirmation, etc. */
  reference: z.string().trim().max(120).optional().or(z.literal("")),
});

export async function payInvoiceFromTrust(
  invoiceId: string,
  _prev: BillingFormState,
  formData: FormData
): Promise<BillingFormState> {
  const userId = await getCurrentUserId();
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = trustPaymentSchema.safeParse(raw);
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
        },
      });
      if (!invoice) throw new Error("Invoice not found.");

      if (invoice.kind !== "client") {
        throw new Error(
          "Trust payments only apply to client invoices — internal records don't carry an AR balance."
        );
      }
      if (invoice.status === "void") {
        throw new Error("Can't pay a voided invoice.");
      }

      const balance = invoice.totalAmount.sub(invoice.paidAmount);
      if (balance.lessThanOrEqualTo(0)) {
        throw new Error("Invoice has no outstanding balance.");
      }
      if (requested.greaterThan(balance)) {
        throw new Error(
          `Amount exceeds the invoice's $${balance.toFixed(2)} balance — pay the balance or less.`
        );
      }

      const matter = await tx.matter.findUnique({
        where: { id: invoice.matterId },
        select: { trustBalance: true },
      });
      if (!matter) throw new Error("Matter not found.");
      if (requested.greaterThan(matter.trustBalance)) {
        throw new Error(
          `Trust balance is $${matter.trustBalance.toFixed(2)} — not enough to cover $${requested.toFixed(2)}. Deposit funds to trust first or pay a smaller amount.`
        );
      }

      // Leg 1: trust ledger row (signed negative for the
      // disbursement; cross-linked back to the invoice).
      const txnDate = data.date ? new Date(data.date) : new Date();
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

      // Leg 2: drop trust balance.
      const newTrust = matter.trustBalance.sub(requested);
      await tx.matter.update({
        where: { id: invoice.matterId },
        data: { trustBalance: newTrust },
      });

      // Leg 3: bump invoice paidAmount; only flip to "paid" when
      // we hit the total. Partial payments leave status alone so
      // the row stays in the open / overdue / sent bucket.
      const newPaid = invoice.paidAmount.add(requested);
      const fullyPaid = newPaid.greaterThanOrEqualTo(invoice.totalAmount);
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          paidAmount: newPaid,
          ...(fullyPaid ? { status: "paid" } : {}),
        },
      });

      return {
        invoiceNumber: invoice.invoiceNumber,
        matterId: invoice.matterId,
        amount: requested,
        fullyPaid,
        trustTxnId: trustTxn.id,
      };
    });

    await logActivity({
      matterId: result.matterId,
      userId,
      type: "deposit",
      title: result.fullyPaid
        ? `Invoice ${result.invoiceNumber} paid in full from trust · $${result.amount.toFixed(2)}`
        : `Partial trust payment to invoice ${result.invoiceNumber} · $${result.amount.toFixed(2)}`,
    });

    revalidatePath(`/matters/${result.matterId}/billing`);
    revalidatePath(`/matters/${result.matterId}`);
    revalidatePath("/", "layout");
    return { ...billingInitialState, status: "ok" };
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : "Couldn't record the payment.",
    };
  }
}
