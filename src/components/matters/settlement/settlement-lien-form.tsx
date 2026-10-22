/**
 * Settlement Lien composer — append-only form for adding a lien
 * row to an existing settlement. Editing / negotiating / deleting an
 * existing row lives in settlement-lien-list.tsx (per-row actions).
 */

"use client";

import { useId, useState } from "react";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { addSettlementLien } from "@/app/actions/settlements";
import {
  LIENHOLDER_TYPES,
  LIENHOLDER_TYPE_LABEL,
  settlementInitialState,
  type SettlementFormState,
} from "@/lib/settlement-constants";
import { FieldError, inputClass } from "@/components/ui/field";

export function SettlementLienForm({ settlementId }: { settlementId: string }) {
  const uid = useId();
  const [expanded, setExpanded] = useState(false);
  const action = addSettlementLien.bind(null, settlementId);
  // Wrapped useActionState: masks state left over from a previous
  // expand, so a failed attempt's errors don't reappear when the
  // form is re-expanded. See src/hooks/use-dialog-action-state.ts.
  const [state, formAction, isPending] = useDialogActionState<SettlementFormState, FormData>(
    action,
    settlementInitialState,
    expanded,
  );

  const [lienholder, setLienholder] = useState("");
  const [lienholderType, setLienholderType] = useState("");
  const [originalAmount, setOriginalAmount] = useState("");

  // Reset + collapse once an add succeeds. Adjusts state during
  // render, keyed on the state OBJECT, not state.status:
  // useActionState keeps its state across submissions, so after the
  // first success the status string is "ok" forever and a second
  // success would be missed. Each action invocation returns a fresh
  // object, so identity is the reliable signal.
  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    if (state.status === "ok") {
      setExpanded(false);
      setLienholder("");
      setLienholderType("");
      setOriginalAmount("");
    }
  }

  if (!expanded) {
    return (
      <Button
        variant="outline"
        size="xs"
        type="button"
        onClick={() => setExpanded(true)}
        className="text-2xs"
      >
        <Plus size={11} />
        Add lien
      </Button>
    );
  }

  const errs = state.errors ?? {};

  return (
    <form
      action={formAction}
      className="flex flex-col gap-2 p-3 rounded-md border border-line bg-paper-2/40"
    >
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-ink">Add lien</div>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-label="Cancel"
          className="text-ink-4 hover:text-ink"
        >
          <X size={14} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-lienholder`} className="text-2xs font-medium text-ink-3">
            Lienholder <span className="text-warn">*</span>
          </label>
          <input
            id={`${uid}-lienholder`}
            name="lienholder"
            type="text"
            required
            value={lienholder}
            placeholder="Denver Health"
            onChange={(e) => setLienholder(e.target.value)}
            className={cn(inputClass(), errs.lienholder && "border-warn")}
          />
          {errs.lienholder && <FieldError>{errs.lienholder[0]}</FieldError>}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-type`} className="text-2xs font-medium text-ink-3">
            Type
          </label>
          <NativeSelect
            className="w-full"
            id={`${uid}-type`}
            name="lienholderType"
            value={lienholderType}
            onChange={(e) => setLienholderType(e.target.value)}
          >
            <NativeSelectOption value="">—</NativeSelectOption>
            {LIENHOLDER_TYPES.map((t) => (
              <NativeSelectOption key={t} value={t}>
                {LIENHOLDER_TYPE_LABEL[t]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-amount`} className="text-2xs font-medium text-ink-3">
            Original amount <span className="text-warn">*</span>
          </label>
          <input
            id={`${uid}-amount`}
            name="originalAmount"
            type="text"
            inputMode="decimal"
            required
            value={originalAmount}
            placeholder="0.00"
            onChange={(e) => setOriginalAmount(e.target.value)}
            className={cn(inputClass(), "font-mono", errs.originalAmount && "border-warn")}
          />
          {errs.originalAmount && <FieldError>{errs.originalAmount[0]}</FieldError>}
        </div>
      </div>

      {state.error && <div className="text-2xs text-warn">{state.error}</div>}

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Adding…" : "Add lien"}
        </Button>
      </div>
    </form>
  );
}
