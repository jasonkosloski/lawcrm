/**
 * Invoice Action Bar — buttons-only render for the top of the
 * preview pane.
 *
 * Renders just the state-machine-aware action buttons; the parent
 * (page.tsx aside header) provides the wrapper chrome (sticky
 * positioning, border, padding) so the same buttons can sit
 * inline next to the close button without doubling up containers.
 *
 * Layout strategy:
 *   - Affirmative transitions (Mark sent, Mark paid) render as
 *     primary / secondary buttons inline. These are the actions
 *     the user is most likely to take while looking at the
 *     invoice.
 *   - Destructive / rare transitions (Void today; could grow into
 *     duplicate / export / etc.) hide behind a small kebab menu
 *     so they're a deliberate two-click action, not an accidental
 *     one-click slip.
 *
 * Terminal states (paid + void after the void escape hatch is
 * gone) render nothing — the document letterhead already shows
 * the status pill, so a separate "no actions available" hint
 * here would just be noise.
 */

"use client";

import { useState, useTransition } from "react";
import {
  Check,
  Landmark,
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
import { setInvoiceStatus } from "@/app/actions/billing";
import {
  invoiceStatusTransitions,
  type InvoiceKind,
} from "@/lib/billing-form";
import { PayFromTrustDialog } from "./pay-from-trust-dialog";
import { RecordPaymentDialog } from "./record-payment-dialog";

export function InvoiceActionBar({
  invoiceId,
  invoiceNumber,
  currentStatus,
  /** Defaults to "client" for back-compat with callers that haven't
   *  threaded kind through yet. Internal records have a much
   *  smaller transition set (no "sent"). */
  kind = "client",
  /** Open balance + trust balance — power the "Pay from trust"
   *  button and the dialog's amount default. Both default to 0 so
   *  the button stays hidden when context is missing. */
  invoiceBalance = 0,
  trustBalance = 0,
}: {
  invoiceId: string;
  invoiceNumber: string;
  currentStatus: string;
  kind?: InvoiceKind;
  invoiceBalance?: number;
  trustBalance?: number;
}) {
  const [pending, startTransition] = useTransition();
  const [trustOpen, setTrustOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const allowed = invoiceStatusTransitions(currentStatus, kind);
  // Pay-from-trust eligibility: client invoice with an open balance,
  // and the matter actually has trust funds. Internal records have
  // no AR; voided invoices have nothing to pay.
  const canPayFromTrust =
    kind === "client" &&
    currentStatus !== "void" &&
    invoiceBalance > 0 &&
    trustBalance > 0;
  // Record-payment eligibility: client invoice with an open balance.
  // Internal records can't take payments (born locked at "Recorded"),
  // and we need somewhere to apply the money.
  const canRecordPayment =
    kind === "client" && currentStatus !== "void" && invoiceBalance > 0;

  // Render nothing only when there's truly nothing to do — no
  // status transitions AND no money paths available.
  if (allowed.length === 0 && !canPayFromTrust && !canRecordPayment)
    return null;

  const transitionTo = (next: string, confirmCopy?: string) => {
    if (confirmCopy && !confirm(confirmCopy)) return;
    startTransition(async () => {
      const res = await setInvoiceStatus(invoiceId, next);
      if (!res.ok) alert(res.error ?? "Couldn't update invoice.");
    });
  };

  // Anything that goes inside the kebab. Today this is just Void,
  // but the slot exists for future "Duplicate", "Export PDF", etc.
  const hasMoreMenu = allowed.includes("void");

  return (
    <div className="flex items-center gap-1.5">
      {allowed.includes("sent") && (
        <button
          type="button"
          onClick={() => transitionTo("sent")}
          disabled={pending}
          className={cn(
            "inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-2xs font-medium",
            "bg-brand-500 text-white hover:bg-brand-600 transition-colors",
            "disabled:opacity-60 disabled:cursor-not-allowed"
          )}
        >
          <Send size={11} />
          Mark sent
        </button>
      )}
      {canPayFromTrust && (
        <button
          type="button"
          onClick={() => setTrustOpen(true)}
          disabled={pending}
          className={cn(
            "inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-2xs font-medium",
            // Primary when this is the only viable "money in" path
            // (i.e., already sent + trust covers it). Secondary
            // otherwise so it sits next to Mark sent.
            !allowed.includes("sent")
              ? "bg-brand-500 text-white hover:bg-brand-600"
              : "border border-line bg-white text-ink hover:border-brand-300 hover:text-brand-700",
            "transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          )}
          title="Record an earned-fee transfer from the matter's IOLTA balance against this invoice"
        >
          <Landmark size={11} />
          Pay from trust
        </button>
      )}
      {/* Client invoices: Record payment opens a dialog that
          captures amount / method / reference and creates a real
          payment record. Auto-flips status to "paid" when the
          payment covers the balance. */}
      {kind === "client" && canRecordPayment && (
        <button
          type="button"
          onClick={() => setRecordOpen(true)}
          disabled={pending}
          className={cn(
            "inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-2xs font-medium",
            // Primary when this is the natural "money in" CTA — i.e.,
            // invoice is already sent and there's no trust covering
            // it. Secondary otherwise so it sits next to Mark sent
            // or Pay from trust without competing.
            !allowed.includes("sent") && !canPayFromTrust
              ? "bg-brand-500 text-white hover:bg-brand-600"
              : "border border-line bg-white text-ink hover:border-brand-300 hover:text-brand-700",
            "transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          )}
          title="Log a payment received against this invoice (check, ACH, cash, card, etc.)"
        >
          <Receipt size={11} />
          Record payment
        </button>
      )}
      {/* Internal records keep the bare "Mark recorded" status flip
          — there's no payment behind them, just a lock. */}
      {kind === "internal_record" && allowed.includes("paid") && (
        <button
          type="button"
          onClick={() =>
            transitionTo(
              "paid",
              `Lock internal record ${invoiceNumber}? Linked time entries stay linked; void unlinks them back to WIP.`
            )
          }
          disabled={pending}
          className={cn(
            "inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-2xs font-medium",
            "bg-brand-500 text-white hover:bg-brand-600",
            "transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          )}
        >
          <Check size={11} />
          Mark recorded
        </button>
      )}
      {hasMoreMenu && (
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
            {allowed.includes("void") && (
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
      {canPayFromTrust && (
        <PayFromTrustDialog
          open={trustOpen}
          onOpenChange={setTrustOpen}
          invoiceId={invoiceId}
          invoiceNumber={invoiceNumber}
          invoiceBalance={invoiceBalance}
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
        />
      )}
    </div>
  );
}
