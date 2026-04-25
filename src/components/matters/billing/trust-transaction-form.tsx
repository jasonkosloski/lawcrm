/**
 * Trust Transaction Composer — manual deposits / disbursements /
 * refunds against the matter's IOLTA balance.
 *
 * Sits inside the trust card on the billing page. Collapsed: a
 * single "Add transaction" button. Expanded: type / amount /
 * description / reference / date form. Server bumps
 * Matter.trustBalance in the same transaction; an attempted
 * overdraw returns a friendly error.
 */

"use client";

import { useActionState, useEffect, useState } from "react";
import { Plus, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { addTrustTransaction } from "@/app/actions/billing";
import {
  TRUST_TXN_TYPES,
  TRUST_TXN_TYPE_LABEL,
  billingInitialState,
  type BillingFormState,
  type TrustTxnType,
} from "@/lib/billing-form";

const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function TrustTransactionForm({ matterId }: { matterId: string }) {
  const action = addTrustTransaction.bind(null, matterId);
  const [state, formAction, isPending] = useActionState<
    BillingFormState,
    FormData
  >(action, billingInitialState);
  const [expanded, setExpanded] = useState(false);
  const [type, setType] = useState<TrustTxnType>("deposit");

  useEffect(() => {
    if (state.status === "ok") {
      setExpanded(false);
      setType("deposit");
    }
  }, [state.status]);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className={cn(
          "inline-flex items-center gap-2 h-8 px-3 text-xs",
          "rounded-md border border-dashed border-line bg-white",
          "hover:border-brand-300 hover:text-brand-700 transition-colors text-ink-3"
        )}
      >
        <Plus size={12} />
        Add transaction
      </button>
    );
  }

  const errs = state.errors ?? {};

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 p-3 rounded-md border border-line bg-paper-2/40"
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-2xs font-mono uppercase tracking-wider text-ink-4">
            Type <span className="text-warn">*</span>
          </label>
          <select
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value as TrustTxnType)}
            className="h-8 px-2 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30"
          >
            {TRUST_TXN_TYPES.map((t) => (
              <option key={t} value={t}>
                {TRUST_TXN_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-2xs font-mono uppercase tracking-wider text-ink-4">
            Amount <span className="text-warn">*</span>
          </label>
          <input
            name="amount"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            required
            className={cn(
              "h-8 px-2.5 rounded-md border bg-white text-xs text-ink font-mono",
              "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
              "placeholder:text-ink-4",
              errs.amount ? "border-warn" : "border-line"
            )}
          />
          {errs.amount && (
            <span className="text-2xs text-warn">{errs.amount[0]}</span>
          )}
        </div>
        <div className="flex flex-col gap-1 col-span-2">
          <label className="text-2xs font-mono uppercase tracking-wider text-ink-4">
            Description <span className="text-warn">*</span>
          </label>
          <input
            name="description"
            type="text"
            required
            maxLength={400}
            placeholder="e.g. Initial retainer · check #4421"
            className={cn(
              "h-8 px-2.5 rounded-md border bg-white text-xs text-ink",
              "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
              "placeholder:text-ink-4",
              errs.description ? "border-warn" : "border-line"
            )}
          />
          {errs.description && (
            <span className="text-2xs text-warn">{errs.description[0]}</span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-2xs font-mono uppercase tracking-wider text-ink-4">
            Reference
          </label>
          <input
            name="reference"
            type="text"
            placeholder="Check #, wire ID, etc."
            maxLength={120}
            className="h-8 px-2.5 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-2xs font-mono uppercase tracking-wider text-ink-4">
            Date
          </label>
          <input
            name="date"
            type="date"
            defaultValue={todayIso()}
            className="h-8 px-2 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30"
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
          {isPending ? "Recording…" : "Record transaction"}
        </button>
      </div>
    </form>
  );
}
