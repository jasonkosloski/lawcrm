/**
 * Billing actions that turn WIP into an invoice row: a client
 * draft invoice (generateInvoiceFromWip) or a born-paid internal
 * record (bundleAsInternalRecord). See ./index.ts for the auth model.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { assertMatterAccess } from "@/lib/matter-access";
import { getCurrentUserId } from "@/lib/current-user";
import { requirePermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import { roundMoney } from "@/lib/money";
import { UserFacingError, toUserMessage } from "@/lib/user-facing-error";
import { billingInitialState, type BillingFormState } from "@/lib/billing-form";
import { TIME_ENTRY_WIP_STATUSES } from "@/lib/constants/time-entry-status";
import {
  invoiceNumberYear,
  describeBundle,
  nextInvoiceNumber,
  retryOnInvoiceNumberCollision,
  sumLineAmounts,
  linkWipToInvoice,
} from "./helpers";

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
  await requirePermission("billing.generate_invoice");
  await assertMatterAccess(matterId);
  const userId = await getCurrentUserId();
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = generateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      error: "Invalid form input.",
    };
  }

  const numberYear = await invoiceNumberYear();

  // Single transaction: lock the WIP rows in, compute total, mint
  // the invoice, attach the rows, flip their status. If any step
  // fails the whole thing rolls back — no half-billed entries.
  // Named so the invoice-number collision path below can re-run
  // the whole transaction (see the P2002 catch).
  const mintInvoice = () =>
    prisma.$transaction(async (tx) => {
      // Serialize generates/bundles on the same matter: lock the
      // matter row BEFORE reading WIP, so a concurrent generate
      // queues here and then sees the entries already linked
      // (it reports "Nothing unbilled") instead of re-pointing
      // them at a second invoice. Lock order is matter only — no
      // invoice row exists yet — so it can't cycle with the
      // payment paths (invoice → matter).
      await tx.$queryRaw`SELECT id FROM matters WHERE id = ${matterId} FOR UPDATE`;
      const matter = await tx.matter.findUnique({
        where: { id: matterId },
        select: { id: true, name: true, clientId: true },
      });
      if (!matter) throw new UserFacingError("Matter not found");

      // Re-pull WIP entries inside the transaction so we don't bill
      // a row a second clock-tick. Only billable + uncharged + un-
      // invoiced + non-billed-status rows count.
      const entries = await tx.timeEntry.findMany({
        where: {
          matterId: matter.id,
          billable: true,
          noCharge: false,
          invoiceId: null,
          status: { in: [...TIME_ENTRY_WIP_STATUSES] },
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
        throw new UserFacingError(
          "Nothing unbilled to invoice — log billable time or expenses first."
        );
      }

      const subtotal = roundMoney(
        sumLineAmounts(entries.map((e) => e.amount)).add(
          sumLineAmounts(expenseRows.map((e) => e.amount))
        )
      );
      // No tax for v1 — firm settings will introduce a per-state
      // rate later. Total = subtotal.
      const total = subtotal;

      const issueDate = new Date();
      const dueDate = new Date(
        issueDate.getTime() + parsed.data.dueDays * 24 * 60 * 60 * 1000
      );

      // Number generation + create. On a concurrent-generate
      // collision the unique index rejects this INSERT — which
      // aborts the whole Postgres transaction, so the retry lives
      // OUTSIDE `mintInvoice` (a retry in here would only see
      // "current transaction is aborted" errors).
      const number = await nextInvoiceNumber(tx, numberYear);
      const invoice = await tx.invoice.create({
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

      // Link every WIP entry to this invoice + flip status to billed.
      // Belt-and-braces with the matter lock above: only rows that
      // are STILL unbilled are linked, and a short count aborts the
      // transaction so an entry can never move between invoices.
      await linkWipToInvoice(tx, invoice.id, entries, expenseRows);

      return {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        matter,
        entryCount: entries.length,
        expenseCount: expenseRows.length,
        total,
      };
    });

  try {
    // P2002 = duplicate invoiceNumber minted by a concurrent
    // generate. That INSERT aborted its transaction, so retry (up to
    // 5 times) by re-running the whole transaction — each fresh run
    // re-reads the committed numbers and picks the next free one.
    const result = await retryOnInvoiceNumberCollision(mintInvoice);

    // Activity log detail spells out both buckets so the audit
    // makes the bundle's composition readable at a glance.
    await logActivity({
      matterId: result.matter.id,
      userId,
      type: "filing",
      title: `Invoice ${result.invoiceNumber} generated`,
      detail: `${describeBundle(result.entryCount, result.expenseCount)} · $${result.total.toFixed(2)}`,
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
      error: toUserMessage(
        err,
        "Couldn't generate invoice.",
        "billing.generateInvoiceFromWip"
      ),
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
  // Same key as generateInvoiceFromWip — bundling is the same
  // "sweep WIP into a document" capability, just born-locked.
  await requirePermission("billing.generate_invoice");
  await assertMatterAccess(matterId);
  const userId = await getCurrentUserId();
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = internalRecordSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const numberYear = await invoiceNumberYear();

  // Named so the invoice-number collision path can re-run the whole
  // transaction — same shape as generateInvoiceFromWip.
  const mintRecord = () =>
    prisma.$transaction(async (tx) => {
      // Serialize generates/bundles on the same matter: lock the
      // matter row BEFORE reading WIP, so a concurrent generate
      // queues here and then sees the entries already linked
      // (it reports "Nothing unbilled") instead of re-pointing
      // them at a second invoice. Lock order is matter only — no
      // invoice row exists yet — so it can't cycle with the
      // payment paths (invoice → matter).
      await tx.$queryRaw`SELECT id FROM matters WHERE id = ${matterId} FOR UPDATE`;
      const matter = await tx.matter.findUnique({
        where: { id: matterId },
        select: { id: true, name: true, clientId: true },
      });
      if (!matter) throw new UserFacingError("Matter not found");

      const entries = await tx.timeEntry.findMany({
        where: {
          matterId: matter.id,
          billable: true,
          noCharge: false,
          invoiceId: null,
          status: { in: [...TIME_ENTRY_WIP_STATUSES] },
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
        throw new UserFacingError("Nothing unbilled to bundle.");
      }

      const subtotal = roundMoney(
        sumLineAmounts(entries.map((e) => e.amount)).add(
          sumLineAmounts(expenseRows.map((e) => e.amount))
        )
      );
      const total = subtotal;

      const issueDate = new Date();

      // Collision handling matches generateInvoiceFromWip: a P2002
      // aborts the transaction, so the retry re-runs `mintRecord`
      // from the outside rather than looping in here.
      const number = await nextInvoiceNumber(tx, numberYear);
      const invoice = await tx.invoice.create({
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

      // Same as client invoices — flip the entries to "billed" so
      // they leave WIP. Void unlinks them back. The "billed" status
      // here doesn't mean "billed to a client"; it means "linked to
      // a bundling document, no longer in WIP". Guarded the same way
      // (see linkWipToInvoice).
      await linkWipToInvoice(tx, invoice.id, entries, expenseRows);

      return {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        matter,
        entryCount: entries.length,
        expenseCount: expenseRows.length,
        total,
      };
    });

  try {
    // Retry the whole transaction on an invoice-number collision —
    // see generateInvoiceFromWip for why the retry can't live inside
    // the (aborted) transaction.
    const result = await retryOnInvoiceNumberCollision(mintRecord);

    await logActivity({
      matterId: result.matter.id,
      userId,
      type: "filing",
      title: `Internal record ${result.invoiceNumber} bundled`,
      detail: `${describeBundle(result.entryCount, result.expenseCount)} · $${result.total.toFixed(2)} (${parsed.data.notes})`,
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
      error: toUserMessage(
        err,
        "Couldn't bundle internal record.",
        "billing.bundleAsInternalRecord"
      ),
    };
  }
}
