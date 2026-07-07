/**
 * Settlement Lien composer — append-only form for adding a lien
 * row to an existing settlement. Edit / negotiate / delete on
 * existing rows is wired separately via per-row actions.
 */

"use client";

import { useState, useEffect } from "react";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { addSettlementLien } from "@/app/actions/settlements";
import {
  settlementInitialState,
  type SettlementFormState,
} from "@/lib/settlement-constants";

export function SettlementLienForm({
  settlementId,
}: {
  settlementId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const action = addSettlementLien.bind(null, settlementId);
  // Wrapped useActionState: masks state left over from a previous
  // expand, so a failed attempt's errors don't reappear when the
  // form is re-expanded. See src/hooks/use-dialog-action-state.ts.
  const [state, formAction, isPending] = useDialogActionState<
    SettlementFormState,
    FormData
  >(action, settlementInitialState, expanded);

  const [lienholder, setLienholder] = useState("");
  const [lienholderType, setLienholderType] = useState("");
  const [originalAmount, setOriginalAmount] = useState("");

  useEffect(() => {
    if (state.status === "ok") {
      setExpanded(false);
      setLienholder("");
      setLienholderType("");
      setOriginalAmount("");
    }
    // Deps key on the state OBJECT, not state.status: useActionState
    // keeps its state across submissions, so after the first success
    // the status string is "ok" forever and a second success would
    // skip the effect, leaving stale values in the form. Each action
    // invocation returns a fresh object, so identity is the reliable
    // signal.
  }, [state]);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-line bg-white text-2xs text-ink hover:border-brand-300 hover:text-brand-700 transition-colors"
      >
        <Plus size={11} />
        Add lien
      </button>
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
          <label className="text-2xs font-mono uppercase tracking-wider text-ink-4">
            Lienholder <span className="text-warn">*</span>
          </label>
          <input
            name="lienholder"
            type="text"
            required
            value={lienholder}
            placeholder="Denver Health"
            onChange={(e) => setLienholder(e.target.value)}
            className={cn(inputClass, errs.lienholder && "border-warn")}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-2xs font-mono uppercase tracking-wider text-ink-4">
            Type
          </label>
          <select
            name="lienholderType"
            value={lienholderType}
            onChange={(e) => setLienholderType(e.target.value)}
            className={inputClass}
          >
            <option value="">—</option>
            <option value="hospital">Hospital</option>
            <option value="physician">Physician</option>
            <option value="insurance">Insurance / subrogation</option>
            <option value="government">Government (Medicare/Medicaid)</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-2xs font-mono uppercase tracking-wider text-ink-4">
            Original amount <span className="text-warn">*</span>
          </label>
          <input
            name="originalAmount"
            type="text"
            inputMode="decimal"
            required
            value={originalAmount}
            placeholder="0.00"
            onChange={(e) => setOriginalAmount(e.target.value)}
            className={cn(inputClass, "font-mono", errs.originalAmount && "border-warn")}
          />
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

const inputClass =
  "h-8 px-2.5 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4";
