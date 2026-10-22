/**
 * Billing action: edit a line item on a DRAFT invoice.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { assertChildMatterAccess } from "@/lib/matter-access";
import { getCurrentUserId } from "@/lib/current-user";
// Date-only inputs ("YYYY-MM-DD") are stored at UTC midnight and read
// in UTC (ADR-012). "Today" is the user's calendar day in their
// profile zone, never the server's.
import { parseDateOnly } from "@/lib/format-date";
import { requirePermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import { hasAtMostDecimals, roundMoney } from "@/lib/money";
import { UserFacingError, toUserMessage } from "@/lib/user-facing-error";
import { type LineItemEditState } from "@/lib/billing-form";
import { sumLineAmounts } from "./helpers";

// ── Invoice line-item editing (DRAFT invoices only) ────────────────────
//
// Editing a line item directly mutates the underlying TimeEntry row +
// re-derives the invoice's subtotal / total in the same transaction.
// Only allowed while the invoice is still a DRAFT. Once `approved` a
// partner has signed off on a specific total (and `sent` means the
// client has the doc), so an in-place edit would silently change an
// approved amount. Void + regenerate is the right path then
// (approved → void is allowed).
//
// Permission model: this action prices invoices (it is the only place
// a rate is set) and rewrites the invoice total, so it needs
// `billing.generate_invoice` — the same key that creates the draft.
// On top of that it keeps the standalone `updateTimeEntry` posture:
// the entry's author can edit their own; other actors need
// `time_entries.edit_any`. Admins short-circuit either path. Every
// edit lands in the activity log with old and new values.

const editableInvoiceStatuses = new Set(["draft"]);

const updateLineItemSchema = z.object({
  date: z.string().min(1, "Date is required"),
  activity: z.string().trim().min(1, "Activity is required").max(200),
  narrative: z.string().max(4000).optional().or(z.literal("")),
  hours: z
    .string()
    .trim()
    .min(1, "Hours required")
    .refine((v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 && n <= 24;
    }, "Hours must be > 0 and ≤ 24"),
  /** Optional. Empty string CLEARS rate and amount — the line stays
   *  on the invoice but stops contributing to the subtotal
   *  (contingent / no-rate matters). Forms must prefill the current
   *  rate to preserve it. Non-empty must be a positive number —
   *  the client's min="0" isn't enforced on the cell-edit path
   *  (EditableLineItemRow posts FormData directly, bypassing the
   *  <form>), so a negative rate has to be rejected here. */
  rate: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .refine(
      (v) => v === undefined || v === "" || (Number.isFinite(Number(v)) && Number(v) > 0),
      "Rate must be a positive number",
    ),
});

export async function updateInvoiceLineItem(
  timeEntryId: string,
  _prev: LineItemEditState,
  formData: FormData,
): Promise<LineItemEditState> {
  // Pricing an invoice line rewrites the invoice total: gate it on
  // the billing key, not just authorship.
  await requirePermission("billing.generate_invoice");
  await assertChildMatterAccess("timeEntry", timeEntryId);
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
      hours: true,
      invoice: { select: { id: true, status: true } },
    },
  });
  if (!entry) {
    return { status: "error", error: "Time entry not found." };
  }
  if (!entry.invoice) {
    return {
      status: "error",
      error: "This entry isn't on an invoice. Use the standard time-entry edit instead.",
    };
  }
  if (!editableInvoiceStatuses.has(entry.invoice.status)) {
    return {
      status: "error",
      error: `Invoice is ${entry.invoice.status}. Line items can only be edited on draft invoices.`,
    };
  }

  // Author bypass; otherwise gate on time_entries.edit_any. Same
  // posture as the standalone updateTimeEntry action.
  const actorId = await getCurrentUserId();
  if (entry.userId !== actorId) {
    await requirePermission("time_entries.edit_any");
  }

  // Hours are billed in 2-decimal units. An UNCHANGED stored value
  // (e.g. a timer entry of 0.3333h whose narrative is being edited)
  // is let through — the cell editor re-posts every field — but a
  // newly typed value must not carry more than 2 decimals.
  const newHoursNum = Number(parsed.data.hours);
  if (!hasAtMostDecimals(parsed.data.hours, 2) && newHoursNum !== entry.hours) {
    return {
      status: "error",
      errors: { hours: ["Hours can have at most 2 decimal places."] },
    };
  }

  // Rate handling: empty string clears BOTH rate and amount — the
  // line drops out of the subtotal (contingent-style rows). There
  // is no "leave unchanged" sentinel; a form that wants to keep the
  // rate must prefill it. Non-empty = parse + use.
  //
  // The zod refinements validate with `Number(...)`, which accepts a
  // few shapes `Decimal` rejects — build the Decimals here so those
  // surface as field errors instead of a raw DecimalError.
  let newRate: Prisma.Decimal | null = null;
  let newHoursDecimal: Prisma.Decimal;
  try {
    newHoursDecimal = new Prisma.Decimal(parsed.data.hours);
  } catch {
    return {
      status: "error",
      errors: { hours: ["Hours must be a number."] },
    };
  }
  if (parsed.data.rate && parsed.data.rate.length > 0) {
    try {
      newRate = new Prisma.Decimal(parsed.data.rate);
    } catch {
      return {
        status: "error",
        errors: { rate: ["Rate must be a positive number"] },
      };
    }
  }
  // Amount = hours * rate rounded to cents when both are present.
  // When rate is null, amount is null too — the entry sits on the
  // invoice but doesn't contribute to the subtotal (matches the
  // existing generateInvoiceFromWip path that skips null amounts).
  // Multiply the exact decimal hours (not the float) so 0.1-style
  // values can't introduce binary noise before rounding.
  const newAmount = newRate ? roundMoney(newRate.mul(newHoursDecimal)) : null;

  const newDate = parseDateOnly(parsed.data.date);
  if (!newDate) {
    return { status: "error", errors: { date: ["Invalid date"] } };
  }

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      // Lock the invoice and re-check its status under the lock: an
      // approve (or send/void) that landed after the pre-check above
      // must not be edited out from under its signer.
      await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${entry.invoice!.id} FOR UPDATE`;
      const invoice = await tx.invoice.findUnique({
        where: { id: entry.invoice!.id },
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          subtotal: true,
          totalAmount: true,
        },
      });
      if (!invoice) throw new UserFacingError("Invoice not found.");
      if (!editableInvoiceStatuses.has(invoice.status)) {
        throw new UserFacingError(
          `Invoice is ${invoice.status}. Line items can only be edited on draft invoices.`,
        );
      }
      const before = await tx.timeEntry.findUnique({
        where: { id: entry.id },
        select: { invoiceId: true, hours: true, rate: true, amount: true },
      });
      if (!before || before.invoiceId !== invoice.id) {
        throw new UserFacingError(
          "This entry is no longer on that invoice — refresh and try again.",
        );
      }

      await tx.timeEntry.update({
        where: { id: entry.id },
        data: {
          date: newDate,
          activity: parsed.data.activity,
          narrative: parsed.data.narrative || null,
          hours: newHoursNum,
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
          where: { invoiceId: invoice.id },
          select: { amount: true },
        }),
        tx.expense.findMany({
          where: { invoiceId: invoice.id },
          select: { amount: true },
        }),
      ]);
      const subtotal = roundMoney(
        sumLineAmounts(timeEntries.map((e) => e.amount)).add(
          sumLineAmounts(expenses.map((e) => e.amount)),
        ),
      );
      // No tax in v1 — total = subtotal. Mirrors generateInvoiceFromWip.
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { subtotal, totalAmount: subtotal },
      });
      return { invoice, before, subtotal };
    });

    const fmt = (d: Prisma.Decimal | null) => (d ? `$${d.toFixed(2)}` : "none");
    await logActivity({
      matterId: entry.matterId,
      userId: actorId,
      type: "filing",
      title: `Invoice ${outcome.invoice.invoiceNumber} line item edited`,
      detail:
        `${parsed.data.activity}: ` +
        `hours ${outcome.before.hours} → ${newHoursNum}, ` +
        `rate ${fmt(outcome.before.rate)} → ${fmt(newRate)}, ` +
        `amount ${fmt(outcome.before.amount)} → ${fmt(newAmount)}; ` +
        `invoice total ${fmt(outcome.invoice.totalAmount)} → ${fmt(outcome.subtotal)}`,
    });

    revalidatePath(`/matters/${entry.matterId}/billing`);
    revalidatePath(`/matters/${entry.matterId}`);
    return { status: "ok" };
  } catch (err) {
    return {
      status: "error",
      error: toUserMessage(err, "Couldn't update line item.", "billing.updateInvoiceLineItem"),
    };
  }
}
