/**
 * Bundle Internal Record — sibling of GenerateInvoiceForm.
 *
 * Closes out WIP without billing. Used on contingency / pro-bono
 * cases that resolve without a fee petition (settled, abandoned,
 * fee already collected via a separate channel). Same bundle-and-
 * lock-WIP mechanic as the real invoice path; the resulting
 * Invoice row is born already-locked at status="paid" with
 * kind="internal_record" and is excluded from Outstanding-AR
 * aggregates.
 *
 * Like the invoice path it sweeps billable expenses as well as time
 * entries, so the confirmation copy counts both.
 *
 * The reason field is required-ish so the resulting record reads
 * naturally on its own ("recorded because: settled with mediator
 * — fees came out of settlement").
 */

"use client";

import { useCallback, useId, useState, useTransition } from "react";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
import { Archive } from "lucide-react";
import { bundleAsInternalRecord } from "@/app/actions/billing";
import { billingInitialState, type BillingFormState } from "@/lib/billing-form";
import { bundleCountLabel, bundleTotal } from "./bundle-summary";
import { formatMoney } from "@/lib/format-money";
import { inputClass, FormErrorBanner } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export function BundleInternalRecordForm({
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
  // Collapse on success, from inside the action wrapper (runs once
  // per invocation, so every success collapses — see
  // GenerateInvoiceForm).
  const action = useCallback(
    async (prev: BillingFormState, formData: FormData) => {
      const res = await bundleAsInternalRecord(matterId, prev, formData);
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
  // typed fields when the server returns a validation / business-rule
  // error. A manual dispatch keeps the user's input so they can
  // correct and resubmit. Native `required` validation still runs
  // before onSubmit fires.
  const [, startSubmit] = useTransition();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startSubmit(() => formAction(fd));
  };

  // Hidden when there's no WIP — the parent surface usually shows a
  // "log billable time first" hint for that case.
  if (entryCount + expenseCount === 0) return null;

  if (!expanded) {
    return (
      <Button
        variant="outline"
        type="button"
        onClick={() => setExpanded(true)}
        className="gap-2 text-xs"
      >
        <Archive size={13} />
        Bundle as internal record
      </Button>
    );
  }

  const errs = state.errors ?? {};

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 p-3 rounded-md border border-line bg-paper-2/40"
    >
      <div className="text-xs text-ink">
        Close out <strong>{bundleCountLabel(entryCount, expenseCount)}</strong> totaling{" "}
        <strong>{formatMoney(bundleTotal(amountTotal, expenseTotal))}</strong> as an internal
        record. No invoice goes to the client; the entries leave WIP and the doc files into the
        matter for tracking.
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${ids}-notes`} className="text-2xs font-medium text-ink-3">
          Reason <span className="text-warn">*</span>
        </label>
        <input
          id={`${ids}-notes`}
          name="notes"
          type="text"
          required
          maxLength={2000}
          autoFocus
          placeholder="e.g. Settled — fees came out of settlement; pro-bono case completed; fee award collected separately"
          className={inputClass(!!errs.notes)}
        />
        {errs.notes && <span className="text-2xs text-warn">{errs.notes[0]}</span>}
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
        <Button variant="outline" size="sm" type="submit" disabled={isPending}>
          {isPending ? "Bundling…" : "Record without billing"}
        </Button>
      </div>
    </form>
  );
}
