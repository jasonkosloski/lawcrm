/**
 * Invoice Action Bar — sticky footer on the preview pane.
 *
 * Mirrors the row kebab actions but in a more affordant button row
 * for the user who's looking AT the invoice. State-machine-aware:
 * only shows transitions allowed from the current status.
 */

"use client";

import { useTransition } from "react";
import { Check, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { setInvoiceStatus } from "@/app/actions/billing";
import { INVOICE_STATUS_TRANSITIONS } from "@/lib/billing-form";

export function InvoiceActionBar({
  invoiceId,
  invoiceNumber,
  currentStatus,
}: {
  invoiceId: string;
  invoiceNumber: string;
  currentStatus: string;
}) {
  const [pending, startTransition] = useTransition();
  const allowed = INVOICE_STATUS_TRANSITIONS[currentStatus] ?? [];

  if (allowed.length === 0) {
    // Terminal state (paid+nothing-allowed-but-void already handled,
    // void → []). Show a small contextual hint instead of a dead bar.
    return (
      <div className="border-t border-line bg-paper-2/60 px-6 py-3">
        <div className="text-2xs text-ink-4 max-w-2xl mx-auto">
          {currentStatus === "void"
            ? "This invoice was voided. Linked time entries returned to billable WIP."
            : "No further actions available on this invoice."}
        </div>
      </div>
    );
  }

  const transitionTo = (next: string, confirmCopy?: string) => {
    if (confirmCopy && !confirm(confirmCopy)) return;
    startTransition(async () => {
      const res = await setInvoiceStatus(invoiceId, next);
      if (!res.ok) alert(res.error ?? "Couldn't update invoice.");
    });
  };

  return (
    <div className="border-t border-line bg-paper-2/60 px-6 py-3">
      <div className="max-w-2xl mx-auto flex items-center gap-2">
        {allowed.includes("sent") && (
          <button
            type="button"
            onClick={() => transitionTo("sent")}
            disabled={pending}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium",
              "bg-brand-500 text-white hover:bg-brand-600 transition-colors",
              "disabled:opacity-60 disabled:cursor-not-allowed"
            )}
          >
            <Send size={12} />
            Mark sent
          </button>
        )}
        {allowed.includes("paid") && (
          <button
            type="button"
            onClick={() =>
              transitionTo(
                "paid",
                `Mark invoice ${invoiceNumber} as fully paid? V1 doesn't support partial payments yet.`
              )
            }
            disabled={pending}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium",
              allowed.includes("sent")
                ? "border border-line bg-white text-ink hover:border-brand-300 hover:text-brand-700"
                : "bg-brand-500 text-white hover:bg-brand-600",
              "transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            )}
          >
            <Check size={12} />
            Mark paid
          </button>
        )}
        {allowed.includes("void") && (
          <button
            type="button"
            onClick={() =>
              transitionTo(
                "void",
                `Void invoice ${invoiceNumber}? Linked time entries return to billable WIP.`
              )
            }
            disabled={pending}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium ml-auto",
              "text-ink-3 hover:text-warn hover:bg-warn-soft",
              "transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            )}
          >
            <X size={12} />
            Void
          </button>
        )}
      </div>
    </div>
  );
}
