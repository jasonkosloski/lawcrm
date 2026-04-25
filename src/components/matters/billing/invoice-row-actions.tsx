/**
 * Invoice Row Actions — kebab on each invoice row.
 *
 * Status transitions only — no inline edit yet (line items aren't
 * editable v1; everything flows through generate / void). The
 * server enforces the same allowed transitions; this just hides
 * impossible options.
 */

"use client";

import { useTransition } from "react";
import { Check, MoreHorizontal, Send, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setInvoiceStatus } from "@/app/actions/billing";
import { INVOICE_STATUS_TRANSITIONS } from "@/lib/billing-form";

export function InvoiceRowActions({
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

  const transitionTo = (next: string, confirmCopy?: string) => {
    if (confirmCopy && !confirm(confirmCopy)) return;
    startTransition(async () => {
      const res = await setInvoiceStatus(invoiceId, next);
      if (!res.ok) alert(res.error ?? "Couldn't update invoice.");
    });
  };

  // Nothing to do — paid + no further transitions, or void.
  if (allowed.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Invoice actions"
            disabled={pending}
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-4 hover:bg-paper-2 hover:text-ink disabled:opacity-50"
          >
            <MoreHorizontal size={14} />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-44">
        {allowed.includes("sent") && (
          <DropdownMenuItem onClick={() => transitionTo("sent")}>
            <Send />
            Mark sent
          </DropdownMenuItem>
        )}
        {allowed.includes("paid") && (
          <DropdownMenuItem
            onClick={() =>
              transitionTo(
                "paid",
                `Mark invoice ${invoiceNumber} as fully paid? V1 doesn't support partial payments yet.`
              )
            }
          >
            <Check />
            Mark paid
          </DropdownMenuItem>
        )}
        {allowed.includes("void") && (
          <>
            {(allowed.includes("sent") || allowed.includes("paid")) && (
              <DropdownMenuSeparator />
            )}
            <DropdownMenuItem
              variant="destructive"
              onClick={() =>
                transitionTo(
                  "void",
                  `Void invoice ${invoiceNumber}? Linked time entries return to billable WIP.`
                )
              }
            >
              <X />
              Void invoice
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
