/**
 * Invoice Action Bar — buttons-only render for the top of the
 * preview pane. State-machine-aware.
 *
 * Client invoices flow draft → approved → sent → partial → paid.
 * The bar exposes exactly the action that moves the invoice to the
 * next step:
 *
 *   draft     → Approve            (one-click, no dialog)
 *   approved  → Send invoice…       (dialog: method / recipient /
 *                                    optional apply-trust)
 *   sent      → Record payment…     (dialog: amount / method incl.
 *                                    trust / reference / memo)
 *   partial   → Record payment…     (same dialog; remaining balance
 *                                    is the default amount)
 *   paid      → (terminal)
 *   void      → (terminal)
 *
 * Internal records keep their pre-refactor machine: a bare "Mark
 * recorded" status flip (draft → paid).
 *
 * Every action is also gated on the viewer's permission flag (props
 * from the billing page): a denied server action redirects to "/"
 * without a message, so the bar never offers what the viewer can't
 * do. Apply trust needs both billing.record_payment and
 * billing.apply_trust, like the server.
 *
 * Void lives in the kebab menu and is refused by the server when
 * any payment has been recorded — the kebab still shows the option
 * but the server is the source of truth (defense-in-depth against
 * stale UI state).
 */

"use client";

import { useState, useTransition } from "react";
import {
  Check,
  CheckCircle2,
  Landmark,
  Mail,
  MoreHorizontal,
  Receipt,
  Send,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  approveInvoice,
  deleteInvoice,
  setInvoiceStatus,
} from "@/app/actions/billing";
import {
  canDeleteInvoice,
  canVoidInvoice,
  invoiceStatusTransitions,
  type InvoiceKind,
} from "@/lib/billing-form";
import {
  confirmAction,
  notifyError,
  type ConfirmOptions,
} from "@/lib/feedback";
import { ApplyTrustDialog } from "./apply-trust-dialog";
import { RecordPaymentDialog } from "./record-payment-dialog";
import { ResendInvoiceDialog } from "./resend-invoice-dialog";
import { SendInvoiceDialog, type PortalSend } from "./send-invoice-dialog";

export function InvoiceActionBar({
  invoiceId,
  invoiceNumber,
  currentStatus,
  /** Defaults to "client" for back-compat with callers that haven't
   *  threaded kind through yet. Internal records have a much
   *  smaller transition set (no "sent"). */
  kind = "client",
  /** Open balance + trust balance — power Record-payment defaults
   *  and the Send dialog's apply-trust option. Both default to 0
   *  so dependent UI stays hidden when context is missing. */
  invoiceBalance = 0,
  trustBalance = 0,
  paidAmount = 0,
  /** Pre-fills the Send dialog's recipient field. Editable in the
   *  dialog if the firm wants a one-shot override. */
  clientEmail = null,
  /** Whether the viewer holds `billing.apply_trust`. Gates every
   *  trust-moving affordance (Apply trust button, Trust payment
   *  method, apply-at-send). Defaults to false so a caller that
   *  forgets it can't expose them; the server enforces the key
   *  regardless. */
  canApplyTrust = false,
  /** Client-portal send availability for the Send dialog. */
  portalSend,
  /** Per-action permission flags, resolved server-side by the page
   *  (`currentUserHasPermission`). Each defaults to false so a
   *  caller that forgets one can't offer a button the server would
   *  answer with a silent redirect to "/" (requirePermission). The
   *  server still enforces every key regardless. */
  canApproveInvoice = false,
  canSendInvoice = false,
  canRecordInvoicePayment = false,
  canVoid = false,
  canDeleteDraft = false,
}: {
  invoiceId: string;
  invoiceNumber: string;
  currentStatus: string;
  kind?: InvoiceKind;
  invoiceBalance?: number;
  trustBalance?: number;
  paidAmount?: number;
  clientEmail?: string | null;
  canApplyTrust?: boolean;
  portalSend?: PortalSend;
  /** billing.approve_invoice — also gates "Mark recorded" (the
   *  server maps the internal-record paid flip to the same key). */
  canApproveInvoice?: boolean;
  /** billing.send_invoice */
  canSendInvoice?: boolean;
  /** billing.record_payment — Apply trust additionally needs
   *  `canApplyTrust` (the server stacks both keys). */
  canRecordInvoicePayment?: boolean;
  /** billing.void_invoice */
  canVoid?: boolean;
  /** billing.delete_draft */
  canDeleteDraft?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [sendOpen, setSendOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [resendOpen, setResendOpen] = useState(false);
  const [applyTrustOpen, setApplyTrustOpen] = useState(false);

  const canApprove =
    canApproveInvoice && kind === "client" && currentStatus === "draft";
  const canSend =
    canSendInvoice && kind === "client" && currentStatus === "approved";
  const canResend =
    canSendInvoice &&
    kind === "client" &&
    (currentStatus === "sent" ||
      currentStatus === "partial" ||
      currentStatus === "paid");
  const canRecordPayment =
    canRecordInvoicePayment &&
    kind === "client" &&
    (currentStatus === "sent" || currentStatus === "partial") &&
    invoiceBalance > 0;
  // Apply-trust shortcut surfaces whenever there's an outstanding
  // balance AND funds in the matter trust to draw from. Same set of
  // states as Record payment, plus the trust > 0 condition. The
  // generic Record payment path still includes Trust as a method,
  // but this button is the one-click "earn out the retainer" flow.
  const showApplyTrust = canApplyTrust && canRecordPayment && trustBalance > 0;
  const canMarkRecorded =
    canApproveInvoice &&
    kind === "internal_record" &&
    invoiceStatusTransitions(currentStatus, kind).includes("paid");
  const deleteAllowed =
    canDeleteDraft && canDeleteInvoice(currentStatus, paidAmount, kind);
  const voidAllowed =
    canVoid && canVoidInvoice(currentStatus, paidAmount, kind);

  const nothingToDo =
    !canApprove &&
    !canSend &&
    !canResend &&
    !canRecordPayment &&
    !showApplyTrust &&
    !canMarkRecorded &&
    !deleteAllowed &&
    !voidAllowed;
  // The Send, Record payment and Re-send dialogs stay mounted
  // whatever the capability flags say (only their triggers are
  // gated): a successful action revalidates props, which can flip
  // canSend / canRecordPayment in the same commit as the new action
  // state, and an unmounted dialog would never run its success /
  // warning effect. Closed and trigger-less, they cannot reopen.
  const dialogs = (
    <>
      <ResendInvoiceDialog
        open={resendOpen}
        onOpenChange={setResendOpen}
        invoiceId={invoiceId}
        invoiceNumber={invoiceNumber}
        clientEmail={clientEmail}
      />
      <SendInvoiceDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        invoiceId={invoiceId}
        invoiceNumber={invoiceNumber}
        invoiceBalance={invoiceBalance}
        clientEmail={clientEmail}
        trustBalance={trustBalance}
        canApplyTrust={canApplyTrust}
        portalSend={portalSend}
      />
      <RecordPaymentDialog
        open={recordOpen}
        onOpenChange={setRecordOpen}
        invoiceId={invoiceId}
        invoiceNumber={invoiceNumber}
        invoiceBalance={invoiceBalance}
        trustBalance={trustBalance}
        clientEmail={clientEmail}
        canApplyTrust={canApplyTrust}
        canSendInvoice={canSendInvoice}
      />
    </>
  );

  const transitionTo = async (next: string, confirmCopy?: ConfirmOptions) => {
    if (confirmCopy && !(await confirmAction(confirmCopy))) return;
    startTransition(async () => {
      const res = await setInvoiceStatus(invoiceId, next);
      if (!res.ok) notifyError(res.error ?? "Couldn't update invoice.");
    });
  };

  const approve = () => {
    startTransition(async () => {
      // Post the total the approver is looking at (a draft has no
      // payments, so its balance is its total): if a line edit moved
      // it since the page loaded, the server refuses instead of
      // approving an amount nobody saw.
      const res = await approveInvoice(invoiceId, invoiceBalance.toFixed(2));
      if (!res.ok) notifyError(res.error ?? "Couldn't approve invoice.");
    });
  };

  const handleDelete = async () => {
    if (
      !(await confirmAction({
        title: `Delete draft invoice ${invoiceNumber}?`,
        description:
          "This removes the row entirely and returns linked time entries to billable WIP.",
        confirmLabel: "Delete invoice",
        destructive: true,
      }))
    )
      return;
    startTransition(async () => {
      const res = await deleteInvoice(invoiceId);
      if (!res.ok) notifyError(res.error ?? "Couldn't delete invoice.");
    });
  };

  const primaryButtonClass = cn(
    "inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-2xs font-medium",
    "bg-brand-700 text-white hover:bg-brand-900 transition-colors",
    "disabled:opacity-60 disabled:cursor-not-allowed",
  );

  return (
    // The button row is conditional but the dialogs below are always a
    // sibling at the same position, so they keep their action state
    // when the last action goes away.
    <>
      {!nothingToDo && (
        <div className="flex items-center gap-1.5">
          {canApprove && (
            <button
              type="button"
              onClick={approve}
              disabled={pending}
              className={primaryButtonClass}
              title="Approve this draft so it can be sent."
            >
              <CheckCircle2 size={11} />
              Approve
            </button>
          )}
          {canSend && (
            <button
              type="button"
              onClick={() => setSendOpen(true)}
              disabled={pending}
              className={primaryButtonClass}
              title="Email the invoice to the client, or post it to the client portal."
            >
              <Send size={11} />
              Send invoice…
            </button>
          )}
          {canRecordPayment && (
            <button
              type="button"
              onClick={() => setRecordOpen(true)}
              disabled={pending}
              className={cn(
                "inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-2xs font-medium",
                // Promote Apply-trust to primary when it's available —
                // it's the more decisive one-click action. Record payment
                // becomes secondary in that case.
                showApplyTrust
                  ? "border border-line bg-white text-ink hover:border-brand-300 hover:text-brand-700"
                  : "bg-brand-700 text-white hover:bg-brand-900",
                "transition-colors disabled:opacity-60 disabled:cursor-not-allowed",
              )}
              title="Log a payment received against this invoice (check, ACH, cash, card, trust, etc.)"
            >
              <Receipt size={11} />
              Record payment
            </button>
          )}
          {showApplyTrust && (
            <button
              type="button"
              onClick={() => setApplyTrustOpen(true)}
              disabled={pending}
              className={primaryButtonClass}
              title={`Apply funds from the matter trust account (avail $${trustBalance.toFixed(2)}) toward this invoice's balance.`}
            >
              <Landmark size={11} />
              Apply trust
            </button>
          )}
          {canMarkRecorded && (
            <button
              type="button"
              onClick={() =>
                transitionTo("paid", {
                  title: `Lock internal record ${invoiceNumber}?`,
                  description:
                    "Linked time entries stay linked; void unlinks them back to WIP.",
                  confirmLabel: "Mark recorded",
                })
              }
              disabled={pending}
              className={primaryButtonClass}
            >
              <Check size={11} />
              Mark recorded
            </button>
          )}
          {(deleteAllowed || voidAllowed || canResend) && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    aria-label="More invoice actions"
                    disabled={pending}
                    className="inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-4 hover:bg-paper-2 hover:text-ink disabled:opacity-50"
                  >
                    <MoreHorizontal size={14} />
                  </button>
                }
              />
              <DropdownMenuContent align="end" className="min-w-44">
                {/* Drafts: hard delete (no audit trail needed — no one
                has seen the doc). Approved/sent: void (preserves
                the row + invoice number for audit). */}
                {canResend && (
                  <DropdownMenuItem onClick={() => setResendOpen(true)}>
                    <Mail />
                    Re-send email…
                  </DropdownMenuItem>
                )}
                {deleteAllowed && (
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={handleDelete}
                  >
                    <Trash2 />
                    Delete draft
                  </DropdownMenuItem>
                )}
                {voidAllowed && (
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() =>
                      transitionTo("void", {
                        title: `Void invoice ${invoiceNumber}?`,
                        description:
                          "Linked time entries return to billable WIP.",
                        confirmLabel: "Void invoice",
                        destructive: true,
                      })
                    }
                  >
                    <Trash2 />
                    Void invoice
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
      {dialogs}
      {showApplyTrust && (
        <ApplyTrustDialog
          open={applyTrustOpen}
          onOpenChange={setApplyTrustOpen}
          invoiceId={invoiceId}
          invoiceNumber={invoiceNumber}
          invoiceBalance={invoiceBalance}
          trustBalance={trustBalance}
          clientEmail={clientEmail}
        />
      )}
    </>
  );
}
