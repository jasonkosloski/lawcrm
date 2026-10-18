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
import { requirePermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import { roundMoney } from "@/lib/money";
import { toUserMessage } from "@/lib/user-facing-error";
import {
  invoiceStatusTransitions,
  canDeleteInvoice,
  canVoidInvoice,
  type InvoiceKind,
} from "@/lib/billing-form";
import {
  ZERO_TOTAL_ERROR,
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
