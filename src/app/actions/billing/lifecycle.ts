/**
 * Billing actions for the invoice lifecycle: status flips (void /
 * mark recorded), deleting a draft, and approving.
 */

"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { assertChildMatterAccess } from "@/lib/matter-access";
import { getCurrentUserId } from "@/lib/current-user";
import { randomUUID } from "node:crypto";
import { requirePermission, currentUserHasPermission } from "@/lib/permission-check";
import { loadFirmProfileForUser } from "@/lib/firm";
import { sendEmail } from "@/lib/email/send";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { formatDateOnly } from "@/lib/format-date";
import { getInvoiceById } from "@/lib/queries/billing";
import { renderInvoicePdf } from "@/lib/billing/invoice-pdf";
import { stampVoid } from "@/lib/billing/void-stamp";
import { stampFiledInvoicePdfs } from "@/lib/billing/void-filing";
import { fileInvoicePdf } from "@/lib/billing/invoice-filing";
import { invoiceVoidEmail } from "@/lib/billing/invoice-email";
import { logActivity } from "@/lib/activity-log";
import { roundMoney } from "@/lib/money";
import { toUserMessage } from "@/lib/user-facing-error";
import {
  invoiceStatusTransitions,
  canDeleteInvoice,
  canVoidInvoice,
  RECIPIENT_EMAIL_RE,
  type BillingFormState,
  type InvoiceKind,
} from "@/lib/billing-form";
import {
  ZERO_TOTAL_ERROR,
  todayDateOnly,
} from "./helpers";

// ── Invoice status transitions ──────────────────────────────────────────

/** Permission key gating each target status reachable through
 *  setInvoiceStatus. Only two flips live here: `void`, and `paid`
 *  — which is solely the internal-record "Mark recorded" flip
 *  (client invoices reach paid/partial exclusively through
 *  recordInvoicePayment), so it shares the approve gate: both are
 *  "finalize the document" acts. Approve and send have dedicated
 *  actions (approveInvoice / sendInvoice) that validate and log the
 *  recipient, the trust leg and the $0 guard — they are deliberately
 *  NOT reachable here, so every other status string is "unknown". */
const SET_STATUS_PERMISSION: Record<string, string> = {
  void: "billing.void_invoice",
  paid: "billing.approve_invoice",
};

/** Returned when a status write loses a race with another change to
 *  the same invoice (its status / paid amount moved since we read it). */
const INVOICE_CHANGED_ERROR =
  "This invoice was changed by someone else just now — refresh and try again.";

export async function setInvoiceStatus(
  invoiceId: string,
  next: string
): Promise<{ ok: boolean; error?: string }> {
  // Own-property check: a plain index lookup would resolve inherited
  // keys ("constructor", "toString") to a function.
  const permissionKey = Object.hasOwn(SET_STATUS_PERMISSION, next)
    ? SET_STATUS_PERMISSION[next]
    : undefined;
  if (!permissionKey) {
    return { ok: false, error: `Unknown invoice status "${next}".` };
  }
  await requirePermission(permissionKey);
  await assertChildMatterAccess("invoice", invoiceId);
  const userId = await getCurrentUserId();
  try {
    return await setInvoiceStatusUnchecked(invoiceId, next, userId);
  } catch (err) {
    return {
      ok: false,
      error: invoiceActionError(err, "billing.setInvoiceStatus"),
    };
  }
}

/** Client-facing message for an invoice mutation that threw after its
 *  permission gate: intentional refusals verbatim, a row deleted out
 *  from under us (P2025) as "not found", anything else generic. The
 *  callers (InvoiceActionBar) only handle a returned `{ ok: false }`;
 *  a throw would replace the whole page with the error boundary. */
function invoiceActionError(err: unknown, context: string): string {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2025"
  ) {
    return "Invoice not found.";
  }
  return toUserMessage(err, "Couldn't update the invoice.", context);
}

async function setInvoiceStatusUnchecked(
  invoiceId: string,
  next: string,
  userId: string
): Promise<{ ok: boolean; error?: string }> {
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

  // Client invoices reach paid/partial ONLY through
  // recordInvoicePayment — every status flip must be paired with a
  // real InvoicePayment row + paidAmount bump. Flipping the status
  // here would leave AR reading "paid" with zero collected, and the
  // state is hard to repair (recordInvoicePayment refuses invoices
  // that aren't sent/partial). Checked before the transition lookup
  // so the pointer is the answer for every client status.
  if (kind === "client" && next === "paid") {
    return {
      ok: false,
      error:
        "Use Record payment instead — paid/partial is set automatically when the payment lands.",
    };
  }

  const allowed = invoiceStatusTransitions(invoice.status, kind);
  if (!(allowed as readonly string[]).includes(next)) {
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

// ── Void with stamp + client notice ─────────────────────────────────────
//
// Voids a client invoice. For one that was `sent` it then stamps the
// filed PDFs VOID (or files a stamped fresh copy when none exist) and
// optionally emails the client the stamped PDF. Stamping happens only
// when THIS call's own void transition succeeded, so a VOID can never
// be stamped over a VOID. The post-commit block can't undo the void:
// failures come back as a warning.

const errMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function voidInvoice(
  invoiceId: string,
  _prev: BillingFormState,
  formData: FormData
): Promise<BillingFormState> {
  await requirePermission("billing.void_invoice");
  await assertChildMatterAccess("invoice", invoiceId);
  const userId = await getCurrentUserId();

  // The email leg needs its own capability on top of void.
  const wantsNotify = formData.get("notifyClient") === "true";
  const notify = wantsNotify && (await currentUserHasPermission("billing.send_invoice"));
  const recipient = String(formData.get("recipient") ?? "").trim();
  if (notify && !RECIPIENT_EMAIL_RE.test(recipient)) {
    return {
      status: "error",
      errors: { recipient: ["Enter a valid email address."] },
    };
  }

  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { matterId: true, invoiceNumber: true, kind: true, status: true },
    });
    if (!invoice) return { status: "error", error: "Invoice not found." };
    const wasSent = invoice.kind === "client" && invoice.status === "sent";
    const n = invoice.invoiceNumber;

    // The void unlinks the time and expenses, so a fresh render has to
    // happen first. Only needed when no PDF was ever filed for it.
    let fresh: Buffer | null = null;
    let renderFailed = false;
    let voidedOn = "";
    let timeZone = "";
    let firm: Awaited<ReturnType<typeof loadFirmProfileForUser>> = null;
    let matterName = "";
    let preDocCount = 0;
    if (wasSent) {
      preDocCount = await prisma.document.count({ where: { invoiceId } });
      voidedOn = formatDateOnly(await todayDateOnly(), "long");
      timeZone = await getCurrentUserTimeZone();
      try {
        firm = await loadFirmProfileForUser(userId);
        const detail = await getInvoiceById(invoiceId, timeZone);
        if (detail) matterName = detail.matterName;
        if (preDocCount === 0) {
          if (!firm || !detail) throw new Error("invoice or firm profile missing");
          fresh = await stampVoid(await renderInvoicePdf(detail, firm, timeZone), voidedOn);
        }
      } catch (err) {
        renderFailed = true;
        console.warn("[void-invoice] pre-void render failed", err);
      }
    }

    const res = await setInvoiceStatusUnchecked(invoiceId, "void", userId);
    if (!res.ok) {
      return { status: "error", error: res.error ?? "Couldn't void the invoice." };
    }
    if (!wasSent) return { status: "ok" };

    const warnings: string[] = [];
    try {
      let pdf: { name: string; bytes: Buffer } | null = null;
      let copiesWarn = false;
      if (preDocCount > 0) {
        const r = await stampFiledInvoicePdfs({ invoiceId, voidedOn });
        if (r.stamped > 0) {
          await logActivity({
            matterId: invoice.matterId,
            userId,
            type: "filing",
            title: `Stamped ${r.stamped} filed PDF(s) of invoice ${n} VOID`,
          });
          pdf = r.latest;
        }
        if (r.failed > 0) copiesWarn = true;
      } else if (fresh) {
        try {
          await fileInvoicePdf({
            matterId: invoice.matterId,
            invoiceId,
            invoiceNumber: n,
            kind: "void",
            bytes: fresh,
            userId,
            day: await todayDateOnly(),
          });
          await logActivity({
            matterId: invoice.matterId,
            userId,
            type: "filing",
            title: `Filed voided copy of invoice ${n}`,
          });
        } catch (err) {
          copiesWarn = true;
          console.warn("[void-invoice] filing voided copy failed", err);
        }
        pdf = { name: `Invoice ${n} (VOID).pdf`, bytes: fresh };
      } else if (renderFailed && !notify) {
        warnings.push("No voided copy could be filed.");
      }
      if (copiesWarn) warnings.push("Some filed copies couldn't be stamped VOID.");
      revalidatePath(`/matters/${invoice.matterId}/documents`);

      if (notify) {
        if (!pdf) {
          warnings.push("No PDF was available, so the client wasn't emailed.");
        } else {
          const sender = await prisma.user.findUnique({
            where: { id: userId },
            select: { email: true },
          });
          const firmName = firm ? (firm.shortName ?? firm.name) : "Our firm";
          const result = await sendEmail({
            to: recipient,
            ...invoiceVoidEmail({ invoiceNumber: n, firmName, matterName }),
            idempotencyKey: `invoice-void-${invoiceId}-${randomUUID()}`,
            fromName: firmName,
            ...(sender?.email ? { replyTo: sender.email } : {}),
            attachments: [
              {
                filename: `Invoice ${n} (VOID).pdf`,
                content: pdf.bytes,
                contentType: "application/pdf",
              },
            ],
          });
          await logActivity({
            matterId: invoice.matterId,
            userId,
            type: "filing",
            title: result.ok
              ? `Void notice for invoice ${n} emailed to ${recipient}`
              : `Void notice for invoice ${n} email failed: ${recipient}`,
            detail: result.ok ? (result.id ? `Resend id ${result.id}` : null) : result.error,
          });
          if (!result.ok) {
            warnings.push(`The void notice didn't go out: ${result.error}.`);
          }
        }
      }
    } catch (err) {
      console.warn("[void-invoice] post-void step failed", err);
      warnings.push(`Some follow-up steps didn't finish: ${errMessage(err)}.`);
    }

    return warnings.length
      ? { status: "ok", warning: `Invoice voided. ${warnings.join(" ")}` }
      : { status: "ok" };
  } catch (err) {
    return { status: "error", error: invoiceActionError(err, "billing.voidInvoice") };
  }
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
  await assertChildMatterAccess("invoice", invoiceId);
  const userId = await getCurrentUserId();
  try {
    return await deleteInvoiceUnchecked(invoiceId, userId);
  } catch (err) {
    return {
      ok: false,
      error: invoiceActionError(err, "billing.deleteInvoice"),
    };
  }
}

async function deleteInvoiceUnchecked(
  invoiceId: string,
  userId: string
): Promise<{ ok: boolean; error?: string }> {
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
  invoiceId: string,
  /** Optional: the total the approver was looking at (e.g. "1234.50").
   *  When given, approval is refused if the invoice total moved since
   *  — the approver must not sign off on a total they never saw. */
  expectedTotal?: string
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("billing.approve_invoice");
  await assertChildMatterAccess("invoice", invoiceId);
  const userId = await getCurrentUserId();
  try {
    return await approveInvoiceUnchecked(invoiceId, userId, expectedTotal);
  } catch (err) {
    return {
      ok: false,
      error: invoiceActionError(err, "billing.approveInvoice"),
    };
  }
}

async function approveInvoiceUnchecked(
  invoiceId: string,
  userId: string,
  expectedTotal: string | undefined
): Promise<{ ok: boolean; error?: string }> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      matterId: true,
      invoiceNumber: true,
      kind: true,
      status: true,
      totalAmount: true,
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
  if (roundMoney(invoice.totalAmount).lessThanOrEqualTo(0)) {
    return { ok: false, error: ZERO_TOTAL_ERROR };
  }
  if (expectedTotal !== undefined) {
    let expected: Prisma.Decimal;
    try {
      expected = roundMoney(expectedTotal);
    } catch {
      return { ok: false, error: "Invalid expected total." };
    }
    if (!expected.equals(roundMoney(invoice.totalAmount))) {
      return { ok: false, error: INVOICE_CHANGED_ERROR };
    }
  }

  // Conditional on the status AND total we validated above (see
  // setInvoiceStatus): 0 rows means someone else moved it, or a
  // line-item edit changed the total, since we read it.
  const approved = await prisma.invoice.updateMany({
    where: {
      id: invoice.id,
      status: "draft",
      kind: "client",
      totalAmount: invoice.totalAmount,
    },
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
