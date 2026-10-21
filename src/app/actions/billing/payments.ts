/**
 * Billing actions that move money onto an invoice: recording a
 * payment on any channel (incl. trust) and sending an invoice with
 * an optional trust application.
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
import { roundMoney } from "@/lib/money";
import { UserFacingError, toUserMessage } from "@/lib/user-facing-error";
import { createNotifications } from "@/lib/notifications";
import { sendEmail } from "@/lib/email/send";
import { invoicePostedEmail } from "@/lib/portal/emails";
import { portalHomeUrl } from "@/lib/portal/link-url";
import { resolvePortalSendTarget } from "@/lib/queries/portal-billing";
import {
  INVOICE_PAYMENT_SOURCES,
  billingInitialState,
  type BillingFormState,
} from "@/lib/billing-form";
import {
  todayDateOnly,
  lockMatterTrustBalance,
  payInvoiceFromTrust,
  ZERO_TOTAL_ERROR,
} from "./helpers";

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
  await assertChildMatterAccess("invoice", invoiceId);
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

  // Optional date-only field: the picked day, or the user's today
  // when left empty. Reject malformed values up front instead of
  // aborting mid-transaction.
  const txnDate = data.date ? parseDateOnly(data.date) : await todayDateOnly();
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
      if (data.source === "trust") {
        // Same lost-update hazard on trustBalance — lock the matter
        // row so concurrent disbursements can't both pass the
        // overdraw check (invoice → matter lock order, see helper).
        const trustBalance = await lockMatterTrustBalance(
          tx,
          invoice.matterId
        );
        if (requested.greaterThan(trustBalance)) {
          throw new UserFacingError(
            `Trust balance is $${trustBalance.toFixed(2)} — not enough to cover $${requested.toFixed(2)}.`
          );
        }
        await payInvoiceFromTrust(tx, {
          invoice,
          trustBalance,
          amount: requested,
          date: txnDate,
          reference: data.reference || null,
          paymentDescription: data.description || null,
          userId,
        });
      } else {
        await tx.invoicePayment.create({
          data: {
            invoiceId: invoice.id,
            source: data.source,
            amount: requested,
            date: txnDate,
            description: data.description || null,
            reference: data.reference || null,
            trustTxnId: null,
            createdBy: userId,
          },
        });
      }

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

    // "Send updated invoice" ticked. NOTHING is emailed today (the
    // dialog says "Logged-only for now"), so the audit row must not
    // claim a delivery. Skip silently if the client has no email on
    // file rather than failing the action: the payment itself still
    // landed correctly.
    if (data.notifyClient && result.clientEmail) {
      await logActivity({
        matterId: result.matterId,
        userId,
        type: "filing",
        title: `Updated invoice ${result.invoiceNumber} copy requested for ${result.clientEmail} (not emailed)`,
        detail: `after $${result.amount.toFixed(2)} ${result.source} payment`,
      });
    }

    // Fan a payment-recorded notification out to the matter's
    // active team — case leads + co-counsel typically want to
    // know money landed. Skips the actor (no point pinging your
    // own bell). Best-effort and fully contained: the payment has
    // already committed, so a failing lookup here must NOT turn
    // into an error result (the user would resubmit and record the
    // payment twice).
    try {
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
    } catch (notifyErr) {
      console.error("[billing.recordInvoicePayment] notify", notifyErr);
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

const sendInvoiceSchema = z
  .object({
  /** "email" records a manual send; "portal" posts the invoice to the
   *  client portal and emails the billed contact a notice; "mail" is
   *  reserved for the future US-mail workflow but rejected here so the
   *  dialog's disabled state is enforced server-side too. */
  method: z.enum(["email", "mail", "portal"]),
  /** Recipient — for email, validated as an email address. For
   *  mail, will become the bill-to mailing address (pulled from
   *  the client) once that path lands. Ignored for portal (the
   *  billed identity is resolved server-side). */
  recipient: z.string().trim().max(320).default(""),
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
  })
  .superRefine((v, ctx) => {
    if (v.method !== "portal" && v.recipient.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["recipient"],
        message: "Recipient is required",
      });
    }
  });

export async function sendInvoice(
  invoiceId: string,
  _prev: BillingFormState,
  formData: FormData
): Promise<BillingFormState> {
  await requirePermission("billing.send_invoice");
  await assertChildMatterAccess("invoice", invoiceId);
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

  // Portal posting: resolve the billed identity before any write (never
  // trust the client's view of availability). The notice goes out after
  // the transaction commits.
  let portalEmail: string | null = null;
  if (data.method === "portal") {
    const target = await resolvePortalSendTarget(invoiceId);
    if (!target.available) return { status: "error", error: target.reason };
    portalEmail = target.email;
  }

  // The trust leg's ledger/payment date: the user's calendar day,
  // resolved before the transaction (date-only, ADR-012).
  const sendDate = data.applyTrust ? await todayDateOnly() : null;

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
          issueDate: true,
          dueDate: true,
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
      // A $0 invoice would satisfy `paid >= total` below and flip
      // straight to a dead-end `paid` with no payment, locking its
      // time entries forever.
      if (roundMoney(invoice.totalAmount).lessThanOrEqualTo(0)) {
        throw new UserFacingError(ZERO_TOTAL_ERROR);
      }

      // Optional apply-trust leg. Same shape as recordInvoicePayment's
      // trust branch — if it would overdraw the invoice or trust, the
      // whole transaction rolls back and the invoice doesn't move.
      let trustApplied: Prisma.Decimal | null = null;
      let newPaid = invoice.paidAmount;
      if (data.applyTrust) {
        // Lock the matter row (trustBalance read-modify-write) —
        // see recordInvoicePayment's trust branch.
        const trustBalance = await lockMatterTrustBalance(
          tx,
          invoice.matterId
        );
        const balance = roundMoney(invoice.totalAmount).sub(
          roundMoney(invoice.paidAmount)
        );
        // Default: cap at MIN(trust, balance). User-supplied amount
        // can step down but never up past the cap. trustAmount was
        // format-validated + $/comma-stripped by the schema.
        const cap = trustBalance.lessThan(balance) ? trustBalance : balance;
        const applied = roundMoney(
          data.trustAmount ? new Prisma.Decimal(data.trustAmount) : cap
        );
        if (applied.lessThanOrEqualTo(0)) {
          throw new UserFacingError("Trust application amount must be greater than 0.");
        }
        if (applied.greaterThan(cap)) {
          throw new UserFacingError(
            `Can apply at most $${cap.toFixed(2)} from trust (limited by ${
              trustBalance.lessThan(balance) ? "trust balance" : "invoice balance"
            }).`
          );
        }
        await payInvoiceFromTrust(tx, {
          invoice,
          trustBalance,
          amount: applied,
          date: sendDate!,
          reference: null,
          paymentDescription: "Earned-fee transfer applied at invoice send",
          userId,
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
      // Sending is when the client first sees the document, so the
      // invoice is dated now with its payment terms preserved. A
      // draft generated Oct 1 (30-day terms) and sent Nov 5 must not
      // arrive already overdue.
      const sentAt = new Date();
      const termMs = Math.max(
        0,
        invoice.dueDate.getTime() - invoice.issueDate.getTime()
      );
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          paidAmount: newPaid,
          status: finalStatus,
          issueDate: sentAt,
          dueDate: new Date(sentAt.getTime() + termMs),
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
    // happened. Two log lines so audit reads cleanly. No email is
    // dispatched yet ("Logged-only for now" in the dialog), so the
    // entry records the invoice as marked sent — not as delivered.
    if (result.method === "portal") {
      // Delivery failure never undoes the send; it is noted on the row.
      let emailFailed = false;
      try {
        const res = await sendEmail({
          to: portalEmail!,
          ...invoicePostedEmail(portalHomeUrl()),
        });
        emailFailed = !res.ok;
      } catch (err) {
        console.warn("[billing] portal invoice email failed", err);
        emailFailed = true;
      }
      await logActivity({
        matterId: result.matterId,
        userId,
        type: "filing",
        title: `Invoice ${result.invoiceNumber} sent via client portal`,
        detail: emailFailed ? "— email failed" : null,
      });
    } else {
      await logActivity({
        matterId: result.matterId,
        userId,
        type: "filing",
        title: `Invoice ${result.invoiceNumber} marked sent via ${result.method} (not emailed)`,
        detail: `to ${result.recipient}`,
      });
    }
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
