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
import { RecordPaymentDialog } from "./record-payment-dialog";
import { SendInvoiceDialog } from "./send-invoice-dialog";

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
}: {
  invoiceId: string;
  invoiceNumber: string;
  currentStatus: string;
  kind?: InvoiceKind;
  invoiceBalance?: number;
  trustBalance?: number;
  paidAmount?: number;
  clientEmail?: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [sendOpen, setSendOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);

  const canApprove = kind === "client" && currentStatus === "draft";
  const canSend = kind === "client" && currentStatus === "approved";
  const canRecordPayment =
    kind === "client" &&
    (currentStatus === "sent" || currentStatus === "partial") &&
    invoiceBalance > 0;
  const canMarkRecorded =
    kind === "internal_record" &&
    invoiceStatusTransitions(currentStatus, kind).includes("paid");
  const deleteAllowed = canDeleteInvoice(currentStatus, paidAmount, kind);
  const voidAllowed = canVoidInvoice(currentStatus, paidAmount, kind);

  const nothingToDo =
    !canApprove &&
    !canSend &&
    !canRecordPayment &&
    !canMarkRecorded &&
    !deleteAllowed &&
    !voidAllowed;
  if (nothingToDo) return null;

  const transitionTo = (next: string, confirmCopy?: string) => {
    if (confirmCopy && !confirm(confirmCopy)) return;
    startTransition(async () => {
      const res = await setInvoiceStatus(invoiceId, next);
      if (!res.ok) alert(res.error ?? "Couldn't update invoice.");
    });
  };

  const approve = () => {
    startTransition(async () => {
      const res = await approveInvoice(invoiceId);
      if (!res.ok) alert(res.error ?? "Couldn't approve invoice.");
    });
  };

  const handleDelete = () => {
    if (
      !confirm(
        `Delete draft invoice ${invoiceNumber}? This removes the row entirely and returns linked time entries to billable WIP.`
      )
    )
      return;
    startTransition(async () => {
      const res = await deleteInvoice(invoiceId);
      if (!res.ok) alert(res.error ?? "Couldn't delete invoice.");
    });
  };

  const primaryButtonClass = cn(
    "inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-2xs font-medium",
    "bg-brand-500 text-white hover:bg-brand-600 transition-colors",
    "disabled:opacity-60 disabled:cursor-not-allowed"
  );

  return (
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
          title="Send this invoice to the client."
        >
          <Send size={11} />
          Send invoice
        </button>
      )}

      {canRecordPayment && (
        <button
          type="button"
          onClick={() => setRecordOpen(true)}
          disabled={pending}
          className={primaryButtonClass}
          title="Log a payment received against this invoice (check, ACH, cash, card, trust, etc.)"
        >
          <Receipt size={11} />
          Record payment
        </button>
      )}

      {canMarkRecorded && (
        <button
          type="button"
          onClick={() =>
            transitionTo(
              "paid",
              `Lock internal record ${invoiceNumber}? Linked time entries stay linked; void unlinks them back to WIP.`
            )
          }
          disabled={pending}
          className={primaryButtonClass}
        >
          <Check size={11} />
          Mark recorded
        </button>
      )}

      {(deleteAllowed || voidAllowed) && (
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
                  transitionTo(
                    "void",
                    `Void invoice ${invoiceNumber}? Linked time entries return to billable WIP.`
                  )
                }
              >
                <Trash2 />
                Void invoice
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {canSend && (
        <SendInvoiceDialog
          open={sendOpen}
          onOpenChange={setSendOpen}
          invoiceId={invoiceId}
          invoiceNumber={invoiceNumber}
          invoiceBalance={invoiceBalance}
          clientEmail={clientEmail}
          trustBalance={trustBalance}
        />
      )}
      {canRecordPayment && (
        <RecordPaymentDialog
          open={recordOpen}
          onOpenChange={setRecordOpen}
          invoiceId={invoiceId}
          invoiceNumber={invoiceNumber}
          invoiceBalance={invoiceBalance}
          trustBalance={trustBalance}
        />
      )}
    </div>
  );
}
