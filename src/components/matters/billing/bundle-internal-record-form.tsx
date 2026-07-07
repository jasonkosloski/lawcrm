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
 * The reason field is required-ish so the resulting record reads
 * naturally on its own ("recorded because: settled with mediator
 * — fees came out of settlement").
 */

"use client";

import { useActionState, useEffect, useState } from "react";
import { Archive, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { bundleAsInternalRecord } from "@/app/actions/billing";
import {
  billingInitialState,
  type BillingFormState,
} from "@/lib/billing-form";

const formatMoney = (n: number): string =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function BundleInternalRecordForm({
  matterId,
  amountTotal,
  entryCount,
}: {
  matterId: string;
  amountTotal: number;
  entryCount: number;
}) {
  const action = bundleAsInternalRecord.bind(null, matterId);
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

  // Hidden when there's no WIP — the parent surface usually shows a
  // "log billable time first" hint for that case.
  if (entryCount === 0) return null;

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className={cn(
          "inline-flex items-center gap-2 h-9 px-3 text-xs font-medium",
          "rounded-md border border-line bg-white text-ink-2",
          "hover:border-brand-300 hover:text-brand-700 transition-colors"
        )}
      >
        <Archive size={13} />
        Bundle as internal record
      </button>
    );
  }

  const errs = state.errors ?? {};

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 p-3 rounded-md border border-line bg-paper-2/40"
    >
      <div className="text-xs text-ink">
        Close out <strong>{entryCount}</strong>{" "}
        {entryCount === 1 ? "entry" : "entries"} totaling{" "}
        <strong>{formatMoney(amountTotal)}</strong> as an internal
        record. No invoice goes to the client; the entries leave WIP
        and the doc files into the matter for tracking.
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-2xs font-mono uppercase tracking-wider text-ink-4">
          Reason <span className="text-warn">*</span>
        </label>
        <input
          name="notes"
          type="text"
          required
          maxLength={2000}
          autoFocus
          placeholder="e.g. Settled — fees came out of settlement; pro-bono case completed; fee award collected separately"
          className={cn(
            "h-8 px-2.5 rounded-md border bg-white text-xs text-ink",
            "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
            "placeholder:text-ink-4",
            errs.notes ? "border-warn" : "border-line"
          )}
        />
        {errs.notes && (
          <span className="text-2xs text-warn">{errs.notes[0]}</span>
        )}
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
            "border border-line bg-white text-ink",
            "hover:border-brand-300 hover:text-brand-700 transition-colors",
            "disabled:opacity-60 disabled:cursor-not-allowed"
          )}
        >
          {isPending ? "Bundling…" : "Record without billing"}
        </button>
      </div>
    </form>
  );
}
