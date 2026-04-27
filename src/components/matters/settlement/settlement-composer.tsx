/**
 * Settlement Composer — inline form for creating or editing the
 * matter's settlement (one per matter in v1). Surfaced on the
 * matter Billing tab inside the Settlement card. The waterfall
 * math (firm fee, lien total, client net) lives on the read side
 * — this form only captures the user-entered numbers (gross,
 * fee %, advanced costs, status).
 */

"use client";

import { useActionState, useEffect, useState } from "react";
import { Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  upsertSettlement,
  settlementInitialState,
  type SettlementFormState,
} from "@/app/actions/settlements";

type SettlementInitial = {
  grossAmount: number;
  firmFeePercent: number | null;
  firmFee: number;
  advancedCosts: number;
  status: string;
} | null;

const formatMoneyInput = (n: number): string =>
  n > 0 ? n.toFixed(2) : "";

export function SettlementComposer({
  matterId,
  initial,
  canEdit,
}: {
  matterId: string;
  initial: SettlementInitial;
  canEdit: boolean;
}) {
  const action = upsertSettlement.bind(null, matterId);
  const [state, formAction, isPending] = useActionState<
    SettlementFormState,
    FormData
  >(action, settlementInitialState);

  // Editing state. When there's an existing settlement we render a
  // "compact" mode showing the saved values + a pencil; opening
  // expands the full form.
  const [expanded, setExpanded] = useState(initial === null);

  const [grossAmount, setGrossAmount] = useState(
    formatMoneyInput(initial?.grossAmount ?? 0)
  );
  const [firmFeePercent, setFirmFeePercent] = useState(
    initial?.firmFeePercent != null ? String(initial.firmFeePercent) : ""
  );
  const [advancedCosts, setAdvancedCosts] = useState(
    formatMoneyInput(initial?.advancedCosts ?? 0)
  );
  const [status, setStatus] = useState(initial?.status ?? "pending");

  useEffect(() => {
    if (state.status === "ok" && initial !== null) {
      // Editing an existing settlement — collapse back to the
      // compact view. New-settlement creates leave the form
      // expanded so the user can keep tweaking.
      setExpanded(false);
    }
  }, [state.status, initial]);

  if (!canEdit && !initial) {
    return (
      <div className="text-2xs text-ink-4 italic">
        No settlement on this matter yet. Settlement.edit permission
        required to open one.
      </div>
    );
  }

  if (!canEdit && initial) {
    return null; // Read-only view is rendered elsewhere via SettlementCard.
  }

  if (!expanded && initial) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="inline-flex items-center gap-1.5 text-2xs text-ink-3 hover:text-brand-700 hover:underline"
      >
        <Pencil size={11} />
        Edit gross / fee / costs / status
      </button>
    );
  }

  const errs = state.errors ?? {};

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 p-3 rounded-md border border-line bg-paper"
    >
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-ink">
          {initial ? "Edit settlement" : "Open settlement"}
        </div>
        {initial && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-label="Cancel"
            className="text-ink-4 hover:text-ink"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Gross amount" required>
          <input
            name="grossAmount"
            type="text"
            inputMode="decimal"
            required
            value={grossAmount}
            placeholder="0.00"
            onChange={(e) => setGrossAmount(e.target.value)}
            className={cn(inputClass, "font-mono", errs.grossAmount && "border-warn")}
          />
          {errs.grossAmount && <FieldError>{errs.grossAmount[0]}</FieldError>}
        </Field>
        <Field label="Firm fee %">
          <input
            name="firmFeePercent"
            type="text"
            inputMode="decimal"
            value={firmFeePercent}
            placeholder="33.33"
            onChange={(e) => setFirmFeePercent(e.target.value)}
            className={cn(inputClass, "font-mono", errs.firmFeePercent && "border-warn")}
          />
          {errs.firmFeePercent && (
            <FieldError>{errs.firmFeePercent[0]}</FieldError>
          )}
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Advanced costs">
          <input
            name="advancedCosts"
            type="text"
            inputMode="decimal"
            value={advancedCosts}
            placeholder="0.00"
            onChange={(e) => setAdvancedCosts(e.target.value)}
            className={cn(inputClass, "font-mono", errs.advancedCosts && "border-warn")}
          />
        </Field>
        <Field label="Status">
          <select
            name="status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={inputClass}
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="disbursed">Disbursed</option>
            <option value="closed">Closed</option>
          </select>
        </Field>
      </div>

      {/* Hidden: explicit firmFee (not exposed in v1 form — percent
          drives it). We pass an empty string so the action falls
          through to "use percent." */}
      <input type="hidden" name="firmFee" value="" />

      {state.error && (
        <div className="text-2xs text-warn">{state.error}</div>
      )}

      <div className="flex justify-end gap-2">
        {initial && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setExpanded(false)}
          >
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : initial ? "Save" : "Open settlement"}
        </Button>
      </div>
    </form>
  );
}

const inputClass =
  "h-8 px-2.5 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4";

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-2xs font-mono uppercase tracking-wider text-ink-4">
        {label} {required && <span className="text-warn">*</span>}
      </label>
      {children}
    </div>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return <span className="text-2xs text-warn">{children}</span>;
}
