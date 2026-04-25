/**
 * Invoice Action Bar — buttons-only render for the top of the
 * preview pane.
 *
 * Renders just the state-machine-aware action buttons; the parent
 * (page.tsx aside header) provides the wrapper chrome (sticky
 * positioning, border, padding) so the same buttons can sit
 * inline next to the close button without doubling up containers.
 *
 * Terminal states (paid + void after the void escape hatch is
 * gone) render nothing — the document letterhead already shows
 * the status pill, so a separate "no actions available" hint
 * here would just be noise.
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

  if (allowed.length === 0) return null;

  const transitionTo = (next: string, confirmCopy?: string) => {
    if (confirmCopy && !confirm(confirmCopy)) return;
    startTransition(async () => {
      const res = await setInvoiceStatus(invoiceId, next);
      if (!res.ok) alert(res.error ?? "Couldn't update invoice.");
    });
  };

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
            "inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-2xs font-medium",
            // When sent isn't an option (already-sent invoice), Mark
            // paid IS the primary CTA; otherwise it's secondary.
            allowed.includes("sent")
              ? "border border-line bg-white text-ink hover:border-brand-300 hover:text-brand-700"
              : "bg-brand-500 text-white hover:bg-brand-600",
            "transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          )}
        >
          <Check size={11} />
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
            "inline-flex items-center gap-1 h-7 px-2 rounded-md text-2xs font-medium",
            "text-ink-3 hover:text-warn hover:bg-warn-soft",
            "transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          )}
          title="Void invoice"
          aria-label="Void invoice"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}
