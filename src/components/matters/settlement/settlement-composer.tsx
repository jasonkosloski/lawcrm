/**
 * Settlement Composer — inline form for creating or editing the
 * matter's settlement (one per matter in v1). Surfaced on the
 * matter Billing tab inside the Settlement card. The waterfall
 * math (firm fee, lien total, client net) lives on the read side
 * — this form only captures the user-entered numbers (gross,
 * fee %, advanced costs, status).
 *
 * Status rules mirror the server (upsertSettlement): a new
 * settlement is always "pending"; an existing one can only be
 * reopened or stepped forward one stage, and only by someone holding
 * the approve permission. The form re-seeds from server data
 * whenever `initial` changes (a save, or an approval-chain
 * auto-promotion) so it never posts a stale status or amounts.
 */

"use client";

import { useId, useState } from "react";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
import { Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { upsertSettlement } from "@/app/actions/settlements";
import {
  settlementInitialState,
  type SettlementFormState,
} from "@/lib/settlement-constants";
import {
  SETTLEMENT_STATUS_LABEL,
  type SettlementStatus,
} from "@/lib/constants/settlement-status";

type SettlementInitial = {
  grossAmount: number;
  firmFeePercent: number | null;
  /** Stored explicit fee. No editable field in v1 — round-tripped
   *  via a hidden input when firmFeePercent is null so saving
   *  doesn't zero an explicitly-set fee. */
  firmFee: number;
  advancedCosts: number;
  status: string;
} | null;

const formatMoneyInput = (n: number): string =>
  n > 0 ? n.toFixed(2) : "";

/** Statuses reachable from `current`, matching the server's rules:
 *  stay, reopen to pending, or step forward one stage. */
function statusOptions(current: string): string[] {
  const next: Record<string, string[]> = {
    pending: ["approved"],
    approved: ["disbursed"],
    disbursed: ["closed"],
    closed: [],
  };
  const forward = next[current] ?? [];
  return current === "pending"
    ? ["pending", ...forward]
    : [current, "pending", ...forward];
}

const statusLabel = (s: string): string =>
  SETTLEMENT_STATUS_LABEL[s as SettlementStatus] ?? s;

export function SettlementComposer({
  matterId,
  initial,
  canEdit,
  canApprove = true,
}: {
  matterId: string;
  initial: SettlementInitial;
  canEdit: boolean;
  /** Holds matters.settlement.approve. When false the status is
   *  shown read-only — the server refuses status changes without
   *  it. Defaults to true so the server stays the authority. */
  canApprove?: boolean;
}) {
  // Editing state. When there's an existing settlement we render a
  // "compact" mode showing the saved values + a pencil; opening
  // expands the full form.
  const [expanded, setExpanded] = useState(initial === null);

  const uid = useId();
  const action = upsertSettlement.bind(null, matterId);
  // Wrapped useActionState: masks state left over from a previous
  // expand, so a failed attempt's errors don't reappear when the
  // form is re-expanded. (New-settlement creates never collapse, so
  // for those the wrapper is inert — errors persist within the one
  // long session, as before.) See src/hooks/use-dialog-action-state.ts.
  const [state, formAction, isPending] = useDialogActionState<
    SettlementFormState,
    FormData
  >(action, settlementInitialState, expanded);

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

  // Re-seed from the server copy whenever it changes. useState only
  // reads `initial` on mount, and this instance survives every
  // revalidation — so after an approval-chain auto-promotion (or a
  // teammate's edit) the select would still hold the old status and
  // the next Save would silently post it back.
  const reseed = (src: SettlementInitial) => {
    setGrossAmount(formatMoneyInput(src?.grossAmount ?? 0));
    setFirmFeePercent(
      src?.firmFeePercent != null ? String(src.firmFeePercent) : ""
    );
    setAdvancedCosts(formatMoneyInput(src?.advancedCosts ?? 0));
    setStatus(src?.status ?? "pending");
  };
  const initialKey = JSON.stringify(initial);
  const [seededKey, setSeededKey] = useState(initialKey);
  if (seededKey !== initialKey) {
    setSeededKey(initialKey);
    reseed(initial);
  }

  // Editing an existing settlement: collapse back to the compact
  // view once a save lands. New-settlement creates leave the form
  // expanded so the user can keep tweaking. Adjusts state during
  // render, keyed on the state OBJECT, not state.status:
  // useActionState keeps its state across submissions, so after the
  // first success the status string is "ok" forever and a second
  // successful edit would be missed. Each action invocation returns
  // a fresh object, so identity is the reliable signal.
  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    if (state.status === "ok" && initial !== null) setExpanded(false);
  }

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
        onClick={() => {
          // Opening always starts from the latest server values, not
          // a draft left over from a cancelled edit.
          reseed(initial);
          setExpanded(true);
        }}
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Gross amount" htmlFor={`${uid}-gross`} required>
          <input
            id={`${uid}-gross`}
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
        <Field label="Firm fee %" htmlFor={`${uid}-pct`}>
          <input
            id={`${uid}-pct`}
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Advanced costs" htmlFor={`${uid}-costs`}>
          <input
            id={`${uid}-costs`}
            name="advancedCosts"
            type="text"
            inputMode="decimal"
            value={advancedCosts}
            placeholder="0.00"
            onChange={(e) => setAdvancedCosts(e.target.value)}
            className={cn(inputClass, "font-mono", errs.advancedCosts && "border-warn")}
          />
          {errs.advancedCosts && (
            <FieldError>{errs.advancedCosts[0]}</FieldError>
          )}
        </Field>
        <Field
          label="Status"
          htmlFor={initial === null || !canApprove ? undefined : `${uid}-status`}
        >
          {initial === null || !canApprove ? (
            // New settlements always start pending; without the
            // approve permission the status can't change. Either
            // way, post the current value unchanged.
            <>
              <input type="hidden" name="status" value={status} />
              <div
                className="h-8 px-2.5 flex items-center rounded-md border border-line bg-paper text-xs text-ink-3"
              >
                {statusLabel(status)}
              </div>
            </>
          ) : (
            <select
              id={`${uid}-status`}
              name="status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className={inputClass}
            >
              {statusOptions(initial.status).map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      {/* Hidden: explicit firmFee (not editable in the v1 form —
          percent drives it when set). Percent-driven settlements
          submit "" so the action recomputes from percent.
          Explicit-fee settlements (percent blank on the record)
          round-trip the stored fee — submitting "" for those would
          silently zero the fee on save. */}
      <input
        type="hidden"
        name="firmFee"
        value={
          initial && initial.firmFeePercent === null
            ? formatMoneyInput(initial.firmFee)
            : ""
        }
      />

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

const labelClass = "text-2xs font-mono uppercase tracking-wider text-ink-4";

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  /** id of the control this label names. Omit for a read-only value
   *  (a div isn't labelable): the label then renders as plain text. */
  htmlFor?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      {htmlFor ? (
        <label htmlFor={htmlFor} className={labelClass}>
          {label} {required && <span className="text-warn">*</span>}
        </label>
      ) : (
        <span className={labelClass}>
          {label} {required && <span className="text-warn">*</span>}
        </span>
      )}
      {children}
    </div>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return <span className="text-2xs text-warn">{children}</span>;
}
