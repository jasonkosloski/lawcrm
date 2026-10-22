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
import { FilePlus2 } from "lucide-react";
import { generateInvoiceFromWip } from "@/app/actions/billing";
import { billingInitialState, type BillingFormState } from "@/lib/billing-form";
import { bundleCountLabel, bundleTotal } from "./bundle-summary";
import { formatMoney } from "@/lib/format-money";
import { inputClass, FormErrorBanner } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

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
    [matterId],
  );
  // Wrapped useActionState: masks state left over from a previous
  // expand, so a failed attempt's error banner doesn't reappear when
  // the form is re-expanded. See src/hooks/use-dialog-action-state.ts.
  const [state, formAction, isPending] = useDialogActionState<BillingFormState, FormData>(
    action,
    billingInitialState,
    expanded,
  );
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
        No unbilled time or expenses on this matter — log billable time or an expense on the Time
        tab to generate an invoice.
      </div>
    );
  }

  const total = bundleTotal(amountTotal, expenseTotal);
  const counts = bundleCountLabel(entryCount, expenseCount);

  if (!expanded) {
    return (
      <Button type="button" onClick={() => setExpanded(true)} className="gap-2 text-xs">
        <FilePlus2 size={13} />
        Generate invoice — {formatMoney(total)} · {counts}
      </Button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 p-3 rounded-md border border-line bg-paper-2/40"
    >
      <div className="text-xs text-ink">
        Bundle <strong>{counts}</strong> totaling <strong>{formatMoney(total)}</strong> into a draft
        invoice.
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-dueDays`} className="text-2xs font-medium text-ink-3">
            Due in (days)
          </label>
          <input
            id={`${ids}-dueDays`}
            name="dueDays"
            type="number"
            min={0}
            max={365}
            defaultValue={30}
            className={inputClass()}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-notes`} className="text-2xs font-medium text-ink-3">
            Notes to client (optional, printed on invoice)
          </label>
          <input
            id={`${ids}-notes`}
            name="notes"
            type="text"
            placeholder="Printed on the invoice the client receives"
            maxLength={2000}
            className={inputClass()}
          />
        </div>
      </div>

      {state.status === "error" && state.error && <FormErrorBanner message={state.error} />}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-2xs text-ink-3 hover:text-ink-2 px-2"
        >
          Cancel
        </button>
        <Button size="sm" type="submit" disabled={isPending}>
          {isPending ? "Generating…" : "Generate draft invoice"}
        </Button>
      </div>
    </form>
  );
}
