/**
 * Generate Invoice from WIP — admin composer.
 *
 * Sits inside the WIP card on the billing page. Collapsed: a single
 * CTA showing the WIP summary ("$X over Y entries — generate
 * invoice"). Expanded: dueDays + notes form, then submit. On
 * success the action revalidates and we collapse back; the new
 * invoice row appears in the invoices table above.
 */

"use client";

import { useActionState, useEffect, useState } from "react";
import { FilePlus2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { generateInvoiceFromWip } from "@/app/actions/billing";
import {
  billingInitialState,
  type BillingFormState,
} from "@/lib/billing-form";

const formatMoney = (n: number): string =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function GenerateInvoiceForm({
  matterId,
  amountTotal,
  entryCount,
}: {
  matterId: string;
  amountTotal: number;
  entryCount: number;
}) {
  const action = generateInvoiceFromWip.bind(null, matterId);
  const [state, formAction, isPending] = useActionState<
    BillingFormState,
    FormData
  >(action, billingInitialState);
  const [expanded, setExpanded] = useState(false);

  // Collapse on success. Deps key on the state OBJECT, not
  // state.status: useActionState keeps its state across
  // submissions, so after the first success the status string is
  // "ok" forever and a second success would skip the effect,
  // leaving the form expanded. Each action invocation returns a
  // fresh object, so identity is the reliable signal.
  useEffect(() => {
    if (state.status === "ok") setExpanded(false);
  }, [state]);

  if (entryCount === 0) {
    return (
      <div className="text-2xs text-ink-4 italic">
        No unbilled time on this matter — log billable time on the Time
        tab to generate an invoice.
      </div>
    );
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className={cn(
          "inline-flex items-center gap-2 h-9 px-3 text-xs font-medium",
          "rounded-md bg-brand-500 text-white hover:bg-brand-600 transition-colors"
        )}
      >
        <FilePlus2 size={13} />
        Generate invoice — {formatMoney(amountTotal)} ·{" "}
        {entryCount} {entryCount === 1 ? "entry" : "entries"}
      </button>
    );
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 p-3 rounded-md border border-line bg-paper-2/40"
    >
      <div className="text-xs text-ink">
        Bundle <strong>{entryCount}</strong>{" "}
        {entryCount === 1 ? "entry" : "entries"} totaling{" "}
        <strong>{formatMoney(amountTotal)}</strong> into a draft invoice.
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-2xs font-mono uppercase tracking-wider text-ink-4">
            Due in (days)
          </label>
          <input
            name="dueDays"
            type="number"
            min={0}
            max={365}
            defaultValue={30}
            className="h-8 px-2.5 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-2xs font-mono uppercase tracking-wider text-ink-4">
            Notes (optional)
          </label>
          <input
            name="notes"
            type="text"
            placeholder="Internal note on this invoice"
            maxLength={2000}
            className="h-8 px-2.5 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4"
          />
        </div>
      </div>

      {state.status === "error" && state.error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-warn-soft border border-warn-border text-2xs text-warn">
          <TriangleAlert size={12} className="shrink-0 mt-px" />
          <span>{state.error}</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-2xs text-ink-3 hover:text-ink-2 px-2"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className={cn(
            "inline-flex items-center h-8 px-3 rounded-md text-xs font-medium",
            "bg-brand-500 text-white hover:bg-brand-600 transition-colors",
            "disabled:opacity-60 disabled:cursor-not-allowed"
          )}
        >
          {isPending ? "Generating…" : "Generate draft invoice"}
        </button>
      </div>
    </form>
  );
}
