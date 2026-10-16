/**
 * Billing server actions — invoices + trust ledger.
 *
 * V1 covers what a solo attorney needs to actually bill a client:
 *   - Generate an invoice from WIP time (one click → draft invoice)
 *   - Transition: draft → sent → paid (or void as the escape hatch)
 *   - Add manual trust deposits / disbursements / refunds (bumps
 *     `Matter.trustBalance` in the same transaction)
 *
 * Auth model: every mutation gates on a `billing.*` / `trust.*`
 * key from the permission catalog (`src/lib/permissions.ts`):
 *   - generateInvoiceFromWip, bundleAsInternalRecord → billing.generate_invoice
 *   - approveInvoice + the approved/mark-recorded flips  → billing.approve_invoice
 *   - sendInvoice + the sent flip                        → billing.send_invoice
 *   - deleteInvoice                                      → billing.delete_draft
 *   - void flips                                         → billing.void_invoice
 *   - recordInvoicePayment                               → billing.record_payment
 *   - sendInvoice's apply-trust leg                      → billing.apply_trust
 *   - recordInvoicePayment with source=trust             → billing.apply_trust
 *   - addTrustTransaction                                → trust.record_transaction
 *   - updateInvoiceLineItem                              → billing.generate_invoice
 *     (stacked with the author / time_entries.edit_any check of the
 *     standalone time-entry actions; DRAFT invoices only)
 *
 * Decimal correctness: every money operation goes through
 * `Prisma.Decimal` math (`.add()`, `.sub()`) so cents never drift.
 * Numbers from the form are parsed once into Decimal and round-
 * tripped through the DB. Every computed amount that is written
 * (line amounts, invoice totals, payments, trust applications) is
 * rounded to cents with `roundMoney` (HALF_UP, `src/lib/money.ts`).
 *
 * Error hygiene: intentional refusals throw `UserFacingError` and are
 * shown verbatim; any other exception is logged server-side and the
 * client gets a generic message (`toUserMessage`).
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma, type Tx } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
// Date-only inputs ("YYYY-MM-DD") must parse to LOCAL midnight —
// `new Date(value)` reads them as UTC midnight, drifting the row a
// day early for anyone west of UTC. See parseLocalDate docs.
import { parseLocalDate } from "@/lib/format-date";
import { requirePermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import { hasAtMostDecimals, roundMoney } from "@/lib/money";
import { UserFacingError, toUserMessage } from "@/lib/user-facing-error";
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
import { TIME_ENTRY_WIP_STATUSES } from "@/lib/constants/time-entry-status";

// ── Helpers ─────────────────────────────────────────────────────────────

/** Generate the next invoice number for the current calendar year.
 *  Format: "YYYY-NNN" (e.g. 2026-007). Counts existing invoices
 *  whose number starts with the year prefix. Race condition path:
 *  if two concurrent generates land on the same number, the
 *  unique-index on Invoice.invoiceNumber rejects the second. The
 *  caller then retries by re-running its WHOLE transaction — a
 *  failed INSERT aborts the Postgres transaction (SQLSTATE 25P02),
 *  so a retry inside the same transaction can never succeed. */
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
  // Row-lock the matter before reading: the read-check-write on
  // trustBalance is a lost-update hazard under READ COMMITTED —
  // two concurrent disbursements would both pass the overdraw
  // check and the second write would clobber the first. FOR UPDATE
  // queues the competitor until this transaction commits, so it
  // re-reads the already-adjusted balance.
  await tx.$queryRaw`SELECT id FROM matters WHERE id = ${matterId} FOR UPDATE`;
  const m = await tx.matter.findUnique({
    where: { id: matterId },
    select: { trustBalance: true },
  });
  if (!m) return { ok: false, error: "Matter not found" };
  const next = roundMoney(m.trustBalance.add(deltaDecimal));
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

/** Sum of per-line amounts, each rounded to cents first (invoice
 *  convention: total = sum of the lines as printed). Null amounts
 *  (unpriced / contingent lines) contribute nothing. */
function sumLineAmounts(
  amounts: ReadonlyArray<Prisma.Decimal | null>
): Prisma.Decimal {
  return amounts.reduce<Prisma.Decimal>(
    (acc, a) => (a ? acc.add(roundMoney(a)) : acc),
    new Prisma.Decimal(0)
  );
}

/** Link the WIP rows an invoice was computed from. Each updateMany is
 *  predicated on the row still being unbilled (`invoiceId: null`, and
 *  a WIP status for time entries); if fewer rows move than were read
 *  (a concurrent generate got there first) the transaction aborts so
 *  the invoice total can never disagree with its line items. */
async function linkWipToInvoice(
  tx: Tx,
  invoiceId: string,
  entries: ReadonlyArray<{ id: string }>,
  expenseRows: ReadonlyArray<{ id: string }>
): Promise<void> {
  const changed = new UserFacingError(
    "Billable time or expenses changed while the invoice was being created — refresh and try again."
  );
  if (entries.length > 0) {
    const res = await tx.timeEntry.updateMany({
      where: {
        id: { in: entries.map((e) => e.id) },
        invoiceId: null,
        status: { in: [...TIME_ENTRY_WIP_STATUSES] },
      },
      data: { invoiceId, status: "billed" },
    });
    if (res.count !== entries.length) throw changed;
  }
  // Expenses don't have a status enum like time entries — the
  // `invoiceId` itself is the "billed" signal.
  if (expenseRows.length > 0) {
    const res = await tx.expense.updateMany({
      where: { id: { in: expenseRows.map((e) => e.id) }, invoiceId: null },
      data: { invoiceId },
    });
    if (res.count !== expenseRows.length) throw changed;
  }
}

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
      const number = await nextInvoiceNumber(tx);
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
    // generate. That INSERT aborted its transaction, so retry once
    // by re-running the whole transaction — the fresh run re-reads
    // the committed numbers and picks the next free one.
    let result: Awaited<ReturnType<typeof mintInvoice>>;
    try {
      result = await mintInvoice();
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        result = await mintInvoice();
      } else {
        throw err;
      }
    }

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
      error: toUserMessage(
        err,
        "Couldn't generate invoice.",
        "billing.generateInvoiceFromWip"
      ),
    };
  }
}

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
      (v) =>
        v === undefined ||
        v === "" ||
        (Number.isFinite(Number(v)) && Number(v) > 0),
      "Rate must be a positive number"
    ),
});

export async function updateInvoiceLineItem(
  timeEntryId: string,
  _prev: LineItemEditState,
  formData: FormData
): Promise<LineItemEditState> {
  // Pricing an invoice line rewrites the invoice total: gate it on
  // the billing key, not just authorship.
  await requirePermission("billing.generate_invoice");
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
      error:
        "This entry isn't on an invoice. Use the standard time-entry edit instead.",
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
  if (
    !hasAtMostDecimals(parsed.data.hours, 2) &&
    newHoursNum !== entry.hours
  ) {
    return {
      status: "error",
      errors: { hours: ["Hours can have at most 2 decimal places."] },
    };
  }

  // Rate handling: empty string clears BOTH rate and amount — the
  // line drops out of the subtotal (contingent-style rows). There
  // is no "leave unchanged" sentinel; a form that wants to keep the
  // rate must prefill it. Non-empty = parse + use.
  const newRate =
    parsed.data.rate && parsed.data.rate.length > 0
      ? new Prisma.Decimal(parsed.data.rate)
      : null;
  // Amount = hours * rate rounded to cents when both are present.
  // When rate is null, amount is null too — the entry sits on the
  // invoice but doesn't contribute to the subtotal (matches the
  // existing generateInvoiceFromWip path that skips null amounts).
  // Multiply the exact decimal hours (not the float) so 0.1-style
  // values can't introduce binary noise before rounding.
  const newAmount = newRate
    ? roundMoney(newRate.mul(new Prisma.Decimal(parsed.data.hours)))
    : null;

  const newDate = parseLocalDate(parsed.data.date);
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
          `Invoice is ${invoice.status}. Line items can only be edited on draft invoices.`
        );
      }
      const before = await tx.timeEntry.findUnique({
        where: { id: entry.id },
        select: { invoiceId: true, hours: true, rate: true, amount: true },
      });
      if (!before || before.invoiceId !== invoice.id) {
        throw new UserFacingError(
          "This entry is no longer on that invoice — refresh and try again."
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
          sumLineAmounts(expenses.map((e) => e.amount))
        )
      );
      // No tax in v1 — total = subtotal. Mirrors generateInvoiceFromWip.
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { subtotal, totalAmount: subtotal },
      });
      return { invoice, before, subtotal };
    });

    const fmt = (d: Prisma.Decimal | null) =>
      d ? `$${d.toFixed(2)}` : "none";
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
      error: toUserMessage(
        err,
        "Couldn't update line item.",
        "billing.updateInvoiceLineItem"
      ),
    };
  }
}

// ── Invoice status transitions ──────────────────────────────────────────

/** Permission key gating each target status reachable through
 *  setInvoiceStatus. "paid" via this action is only the internal-
 *  record "Mark recorded" flip (client invoices reach paid/partial
 *  exclusively through recordInvoicePayment), so it shares the
 *  approve gate — both are "finalize the document" acts. "partial"
 *  is client-only and always refused below with a pointer to
 *  recordInvoicePayment; it gates on the payment key so the refusal
 *  isn't reachable by users who couldn't record the payment anyway. */
const SET_STATUS_PERMISSION: Record<string, string> = {
  approved: "billing.approve_invoice",
  sent: "billing.send_invoice",
  void: "billing.void_invoice",
  paid: "billing.approve_invoice",
  partial: "billing.record_payment",
};

/** Returned when a status write loses a race with another change to
 *  the same invoice (its status / paid amount moved since we read it). */
const INVOICE_CHANGED_ERROR =
  "This invoice was changed by someone else just now — refresh and try again.";

export async function setInvoiceStatus(
  invoiceId: string,
  next: string
): Promise<{ ok: boolean; error?: string }> {
  const permissionKey = SET_STATUS_PERMISSION[next];
  if (!permissionKey) {
    return { ok: false, error: `Unknown invoice status "${next}".` };
  }
  await requirePermission(permissionKey);
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
  if (!(allowed as readonly string[]).includes(next)) {
    return {
      ok: false,
      error: `Can't transition ${invoice.status} → ${next}.`,
    };
  }

  // Client invoices reach paid/partial ONLY through
  // recordInvoicePayment — every status flip must be paired with a
  // real InvoicePayment row + paidAmount bump. Flipping the status
  // here would leave AR reading "paid" with zero collected, and the
  // state is hard to repair (recordInvoicePayment refuses invoices
  // that aren't sent/partial).
  if (kind === "client" && (next === "paid" || next === "partial")) {
    return {
      ok: false,
      error:
        "Use Record payment instead — paid/partial is set automatically when the payment lands.",
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
  const data: Prisma.InvoiceUpdateManyMutationInput =
    next === "paid" && kind === "internal_record"
      ? { status: next, paidAmount: invoice.totalAmount }
      : { status: next };

  // The checks above ran against a snapshot read outside any
  // transaction. Make the write conditional on that snapshot still
  // being true (status AND paidAmount): a payment / send / approve
  // that committed in between makes the predicate match 0 rows and
  // we refuse instead of voiding a paid invoice (or re-flipping a
  // moved one). The predicate runs FIRST in the transaction, before
  // any entries are unlinked.
  const transitioned = await prisma.$transaction(async (tx) => {
    const claimed = await tx.invoice.updateMany({
      where: {
        id: invoice.id,
        status: invoice.status,
        paidAmount: invoice.paidAmount,
      },
      data,
    });
    if (claimed.count === 0) return false;
    if (next === "void") {
      // Void → unlink time entries so they go back into WIP. The
      // pre-invoice status isn't stored anywhere, so every entry is
      // reset to a uniform "billable" (a draft entry swept into the
      // invoice comes back ready-to-bill, not as a draft). Expenses
      // are unlinked too so they can roll into a future invoice.
      // Otherwise voiding strands billable hours at status="billed"
      // and expenses pinned to a now-voided invoice.
      await tx.timeEntry.updateMany({
        where: { invoiceId: invoice.id },
        data: { invoiceId: null, status: "billable" },
      });
      await tx.expense.updateMany({
        where: { invoiceId: invoice.id },
        data: { invoiceId: null },
      });
    }
    return true;
  });
  if (!transitioned) return { ok: false, error: INVOICE_CHANGED_ERROR };

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
  await requirePermission("billing.delete_draft");
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
  //
  // The eligibility check above read a snapshot outside the
  // transaction; lock the row and re-run it under the lock so a
  // concurrent approve / payment can't slip a no-longer-draft invoice
  // through the delete.
  const deleted = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoice.id} FOR UPDATE`;
    const fresh = await tx.invoice.findUnique({
      where: { id: invoice.id },
      select: { kind: true, status: true, paidAmount: true },
    });
    if (
      !fresh ||
      !canDeleteInvoice(
        fresh.status,
        fresh.paidAmount.toNumber(),
        fresh.kind as InvoiceKind
      )
    ) {
      return false;
    }
    await tx.timeEntry.updateMany({
      where: { invoiceId: invoice.id },
      data: { invoiceId: null, status: "billable" },
    });
    await tx.invoice.delete({ where: { id: invoice.id } });
    return true;
  });
  if (!deleted) return { ok: false, error: INVOICE_CHANGED_ERROR };

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
// Single-step transition draft → approved, gated behind
// billing.approve_invoice. The approver lands in the activity log;
// a dedicated audit row (approver + timestamp on the invoice) is
// still future work.

export async function approveInvoice(
  invoiceId: string
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("billing.approve_invoice");
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

  // Conditional on the status we validated above (see
  // setInvoiceStatus): 0 rows means someone else moved it first.
  const approved = await prisma.invoice.updateMany({
    where: { id: invoice.id, status: "draft", kind: "client" },
    data: { status: "approved" },
  });
  if (approved.count === 0) return { ok: false, error: INVOICE_CHANGED_ERROR };

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
  await requirePermission("trust.record_transaction");
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
  const positive = roundMoney(data.amount);
  // Disbursement / refund are stored as negative amounts so trust
  // sums match the balance directly. Deposits stay positive.
  const signed =
    data.type === "deposit" ? positive : positive.neg();

  // Optional date-only field: local midnight of the picked day, or
  // "now" when left empty. Reject malformed values up front instead
  // of aborting mid-transaction.
  const txnDate = data.date ? parseLocalDate(data.date) : new Date();
  if (!txnDate) {
    return { status: "error", errors: { date: ["Invalid date"] } };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const balanceCheck = await adjustTrustBalance(tx, matterId, signed);
      if (!balanceCheck.ok) throw new UserFacingError(balanceCheck.error ?? "Trust update failed.");
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
      error: toUserMessage(
        err,
        "Couldn't record transaction.",
        "billing.addTrustTransaction"
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
  const userId = await getCurrentUserId();
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = internalRecordSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

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
      const number = await nextInvoiceNumber(tx);
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
        total,
      };
    });

  try {
    // Retry the whole transaction once on an invoice-number
    // collision — see generateInvoiceFromWip for why the retry
    // can't live inside the (aborted) transaction.
    let result: Awaited<ReturnType<typeof mintRecord>>;
    try {
      result = await mintRecord();
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        result = await mintRecord();
      } else {
        throw err;
      }
    }

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
      error: toUserMessage(
        err,
        "Couldn't bundle internal record.",
        "billing.bundleAsInternalRecord"
      ),
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
  await requirePermission("billing.record_payment");
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
  // Paying from trust moves client money — the same distinct
  // capability sendInvoice stacks for its apply-trust leg. Kept
  // outside the try/catch below: a denied gate must redirect, not
  // become a form error.
  if (data.source === "trust") {
    await requirePermission("billing.apply_trust");
  }
  const requested = roundMoney(data.amount);

  // Optional date-only field: local midnight of the picked day, or
  // "now" when left empty. Reject malformed values up front instead
  // of aborting mid-transaction.
  const txnDate = data.date ? parseLocalDate(data.date) : new Date();
  if (!txnDate) {
    return { status: "error", errors: { date: ["Invalid date"] } };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Row-lock the invoice before reading paidAmount: the
      // read-check-write below is a lost-update hazard under READ
      // COMMITTED — two concurrent submissions of the same payment
      // would both pass the balance check, both create payment
      // rows, and the second paidAmount write would clobber the
      // first (payments summing past paidAmount / past total).
      // FOR UPDATE queues the competitor until this commits, so it
      // re-reads the bumped balance and refuses.
      await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId} FOR UPDATE`;
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
      if (!invoice) throw new UserFacingError("Invoice not found.");
      if (invoice.kind !== "client") {
        throw new UserFacingError(
          "Payments only apply to client invoices — internal records have no AR balance."
        );
      }
      if (invoice.status !== "sent" && invoice.status !== "partial") {
        throw new UserFacingError(
          `Payments are only recordable on sent or partially-paid invoices (this one is ${invoice.status}). Approve and send the invoice first.`
        );
      }

      // Balance at cent precision: older rows may carry sub-cent
      // totals (unrounded hours x rate), which would otherwise make
      // the displayed balance unpayable.
      const invoiceTotal = roundMoney(invoice.totalAmount);
      const balance = invoiceTotal.sub(roundMoney(invoice.paidAmount));
      if (balance.lessThanOrEqualTo(0)) {
        throw new UserFacingError("Invoice has no outstanding balance.");
      }
      if (requested.greaterThan(balance)) {
        throw new UserFacingError(
          `Amount exceeds the invoice's $${balance.toFixed(2)} balance — record the balance or less.`
        );
      }


      // Trust path: write the trust ledger leg + decrement the
      // matter trust balance, refusing on overdraw. The InvoicePayment
      // row links back to the TrustTransaction for cross-navigation.
      let trustTxnId: string | null = null;
      if (data.source === "trust") {
        // Same lost-update hazard on trustBalance — lock the matter
        // row so concurrent disbursements can't both pass the
        // overdraw check. Lock order is invoice → matter everywhere
        // (here and sendInvoice) to keep deadlocks impossible.
        await tx.$queryRaw`SELECT id FROM matters WHERE id = ${invoice.matterId} FOR UPDATE`;
        const matter = await tx.matter.findUnique({
          where: { id: invoice.matterId },
          select: { trustBalance: true },
        });
        if (!matter) throw new UserFacingError("Matter not found.");
        if (requested.greaterThan(matter.trustBalance)) {
          throw new UserFacingError(
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
          data: { trustBalance: roundMoney(matter.trustBalance.sub(requested)) },
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

      const newPaid = roundMoney(invoice.paidAmount.add(requested));
      const fullyPaid = newPaid.greaterThanOrEqualTo(invoiceTotal);
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
      error: toUserMessage(
        err,
        "Couldn't record the payment.",
        "billing.recordInvoicePayment"
      ),
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
   *  Defaults to MIN(trust balance, invoice balance) on the client.
   *  Same strict money format as every other amount in this file —
   *  a bare string would let "abc" throw a raw DecimalError at the
   *  user and "5.999" put sub-cent amounts into the trust ledger. */
  trustAmount: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v.replace(/[$,]/g, "") : v))
    .refine(
      (v) => !v || /^\d+(\.\d{1,2})?$/.test(v),
      "Enter a valid amount"
    ),
});

export async function sendInvoice(
  invoiceId: string,
  _prev: BillingFormState,
  formData: FormData
): Promise<BillingFormState> {
  await requirePermission("billing.send_invoice");
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
  // Applying trust moves client money — a distinct capability from
  // sending, so it stacks a second gate on top of send.
  if (data.applyTrust) {
    await requirePermission("billing.apply_trust");
  }
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
      // Same lock discipline as recordInvoicePayment (invoice →
      // matter): paidAmount is read-modify-written below, so a
      // concurrent payment against this invoice must queue rather
      // than race the balance check.
      await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId} FOR UPDATE`;
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
      if (!invoice) throw new UserFacingError("Invoice not found.");
      if (invoice.kind !== "client") {
        throw new UserFacingError("Only client invoices get sent.");
      }
      if (invoice.status !== "approved") {
        throw new UserFacingError(
          `Send is only available on approved invoices (this one is ${invoice.status}). Approve it first.`
        );
      }

      // Optional apply-trust leg. Same shape as recordInvoicePayment's
      // trust branch — if it would overdraw the invoice or trust, the
      // whole transaction rolls back and the invoice doesn't move.
      let trustApplied: Prisma.Decimal | null = null;
      let newPaid = invoice.paidAmount;
      if (data.applyTrust) {
        // Lock the matter row (trustBalance read-modify-write) —
        // see recordInvoicePayment's trust branch.
        await tx.$queryRaw`SELECT id FROM matters WHERE id = ${invoice.matterId} FOR UPDATE`;
        const matter = await tx.matter.findUnique({
          where: { id: invoice.matterId },
          select: { trustBalance: true },
        });
        if (!matter) throw new UserFacingError("Matter not found.");
        const balance = roundMoney(invoice.totalAmount).sub(
          roundMoney(invoice.paidAmount)
        );
        // Default: cap at MIN(trust, balance). User-supplied amount
        // can step down but never up past the cap. trustAmount was
        // format-validated + $/comma-stripped by the schema.
        const cap = matter.trustBalance.lessThan(balance)
          ? matter.trustBalance
          : balance;
        const applied = roundMoney(
          data.trustAmount ? new Prisma.Decimal(data.trustAmount) : cap
        );
        if (applied.lessThanOrEqualTo(0)) {
          throw new UserFacingError("Trust application amount must be greater than 0.");
        }
        if (applied.greaterThan(cap)) {
          throw new UserFacingError(
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
          data: { trustBalance: roundMoney(matter.trustBalance.sub(applied)) },
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
        newPaid = roundMoney(invoice.paidAmount.add(applied));
        trustApplied = applied;
      }

      // Final status: paid if trust covered the whole thing, partial
      // if it covered some, sent otherwise.
      const fullyPaid = newPaid.greaterThanOrEqualTo(
        roundMoney(invoice.totalAmount)
      );
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
      error: toUserMessage(
        err,
        "Couldn't send the invoice.",
        "billing.sendInvoice"
      ),
    };
  }
}
