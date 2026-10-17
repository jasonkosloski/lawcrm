/**
 * Generate Invoice from WIP — admin composer.
 *
 * Sits inside the WIP card on the billing page. Collapsed: a single
 * CTA showing the WIP summary ("$X over Y entries + Z expenses —
 * generate invoice"). Expanded: dueDays + notes form, then submit. On
 * success the action revalidates and we collapse back; the new
 * invoice row appears in the invoices table above.
 *
 * WIP here is time entries AND billable expenses: the server action
 * bundles both and only refuses when both are empty, so a matter
 * with only unbilled expenses (a filing fee) must still be invoiceable
 * from this button.
 */

"use client";

import { useCallback, useId, useState, useTransition } from "react";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
import { FilePlus2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { generateInvoiceFromWip } from "@/app/actions/billing";
import {
  billingInitialState,
  type BillingFormState,
} from "@/lib/billing-form";
import { bundleCountLabel, bundleTotal } from "./bundle-summary";

const formatMoney = (n: number): string =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function GenerateInvoiceForm({
  matterId,
  amountTotal,
  entryCount,
  expenseTotal = 0,
  expenseCount = 0,
}: {
  matterId: string;
  /** Unbilled time dollars. */
  amountTotal: number;
  /** Unbilled time entries. */
  entryCount: number;
  /** Unbilled billable expense dollars (the server bundles them too). */
  expenseTotal?: number;
  /** Unbilled billable expenses. */
  expenseCount?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const ids = useId();
  // Collapse on success, from inside the action wrapper: it runs once
  // per invocation, so a SECOND success collapses the form too (an
  // effect keyed on `state.status` would not re-fire — the status
  // stays "ok" — and one keyed on the state object needs a setState
  // inside an effect).
  const action = useCallback(
    async (prev: BillingFormState, formData: FormData) => {
      const res = await generateInvoiceFromWip(matterId, prev, formData);
      if (res.status === "ok") setExpanded(false);
      return res;
    },
    [matterId]
  );
  // Wrapped useActionState: masks state left over from a previous
  // expand, so a failed attempt's error banner doesn't reappear when
  // the form is re-expanded. See src/hooks/use-dialog-action-state.ts.
  const [state, formAction, isPending] = useDialogActionState<
    BillingFormState,
    FormData
  >(action, billingInitialState, expanded);
  // Dispatch via onSubmit + startTransition instead of
  // <form action={formAction}>: React 19 resets every form-action
  // form after the action settles — error or not — which wipes the
  // typed fields (and snaps an uncontrolled-looking select back to
  // its first option) when the server returns a validation /
  // business-rule error. A manual dispatch keeps the user's input so
  // they can correct and resubmit. Native `required` validation
  // still runs before onSubmit fires.
  const [, startSubmit] = useTransition();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startSubmit(() => formAction(fd));
  };

  if (entryCount + expenseCount === 0) {
    return (
      <div className="text-2xs text-ink-4 italic">
        No unbilled time or expenses on this matter — log billable time
        or an expense on the Time tab to generate an invoice.
      </div>
    );
  }

  const total = bundleTotal(amountTotal, expenseTotal);
  const counts = bundleCountLabel(entryCount, expenseCount);

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
        Generate invoice — {formatMoney(total)} · {counts}
      </button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 p-3 rounded-md border border-line bg-paper-2/40"
    >
      <div className="text-xs text-ink">
        Bundle <strong>{counts}</strong> totaling{" "}
        <strong>{formatMoney(total)}</strong> into a draft invoice.
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label
            htmlFor={`${ids}-dueDays`}
            className="text-2xs font-mono uppercase tracking-wider text-ink-4"
          >
            Due in (days)
          </label>
          <input
            id={`${ids}-dueDays`}
            name="dueDays"
            type="number"
            min={0}
            max={365}
            defaultValue={30}
            className="h-8 px-2.5 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor={`${ids}-notes`}
            className="text-2xs font-mono uppercase tracking-wider text-ink-4"
          >
            Notes to client (optional, printed on invoice)
          </label>
          <input
            id={`${ids}-notes`}
            name="notes"
            type="text"
            placeholder="Printed on the invoice the client receives"
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
