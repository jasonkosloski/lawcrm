/**
 * Settlement Lien List — the liens on a settlement, one row each,
 * with per-row Edit (negotiated amount + status) and Delete for
 * holders of matters.settlement.manage_liens.
 *
 * Adding a lien is SettlementLienForm. A mistyped ORIGINAL amount or
 * lienholder can't be edited (the lien update action only changes the
 * negotiated amount and status), so the fix is Delete and re-add.
 *
 * The server refuses lien changes once the settlement is approved,
 * disbursed or closed (they move the client net the sign-offs vouch
 * for); `locked` hides the controls to match.
 */

"use client";

import { useId, useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  deleteSettlementLien,
  updateSettlementLien,
} from "@/app/actions/settlements";
import {
  LIENHOLDER_TYPE_LABEL,
  settlementInitialState,
  type LienholderType,
  type SettlementFormState,
} from "@/lib/settlement-constants";
import {
  SETTLEMENT_LIEN_STATUSES,
  SETTLEMENT_LIEN_STATUS_LABEL,
  type SettlementLienStatus,
} from "@/lib/constants/settlement-status";
import { confirmAction } from "@/lib/feedback";

export type SettlementLienListRow = {
  id: string;
  lienholder: string;
  lienholderType: string | null;
  originalAmount: number;
  negotiatedAmount: number | null;
  effectiveAmount: number;
  status: string;
};

const formatMoney = (n: number): string =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const lienStatusLabel = (s: string): string =>
  SETTLEMENT_LIEN_STATUS_LABEL[s as SettlementLienStatus] ?? s;

const lienTypeLabel = (t: string | null): string =>
  t ? (LIENHOLDER_TYPE_LABEL[t as LienholderType] ?? t) : "—";

export function SettlementLienList({
  liens,
  canManage,
  locked,
}: {
  liens: SettlementLienListRow[];
  /** Holds matters.settlement.manage_liens. */
  canManage: boolean;
  /** Settlement is approved, disbursed or closed — liens are read-only. */
  locked: boolean;
}) {
  if (liens.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-2xs font-mono uppercase tracking-wider text-ink-4">
        Liens
      </div>
      <ul className="border border-line rounded-md overflow-hidden divide-y divide-line">
        {liens.map((l) => (
          <LienRow key={l.id} lien={l} canManage={canManage && !locked} />
        ))}
      </ul>
    </div>
  );
}

function LienRow({
  lien,
  canManage,
}: {
  lien: SettlementLienListRow;
  canManage: boolean;
}) {
  const uid = useId();
  const [editing, setEditing] = useState(false);
  const [negotiated, setNegotiated] = useState("");
  const [status, setStatus] = useState(lien.status);
  const [deleting, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const action = updateSettlementLien.bind(null, lien.id);
  const [state, formAction, isPending] = useDialogActionState<
    SettlementFormState,
    FormData
  >(action, settlementInitialState, editing);

  // Close the editor once a save lands. Adjusts state during render,
  // keyed on the state OBJECT (see SettlementLienForm for why).
  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    if (state.status === "ok") setEditing(false);
  }

  const openEditor = () => {
    // Always start from the latest server values, never a draft left
    // over from a cancelled edit. Blank negotiated = "use original".
    setNegotiated(
      lien.negotiatedAmount !== null ? lien.negotiatedAmount.toFixed(2) : ""
    );
    setStatus(lien.status);
    setDeleteError(null);
    setEditing(true);
  };

  const handleDelete = async () => {
    if (
      !(await confirmAction({
        title: `Remove the ${lien.lienholder} lien (${formatMoney(lien.effectiveAmount)})?`,
        description: "This is permanent. The audit log keeps a record.",
        confirmLabel: "Remove lien",
        destructive: true,
      }))
    )
      return;
    setDeleteError(null);
    startDelete(async () => {
      const res = await deleteSettlementLien(lien.id);
      if (!res.ok) setDeleteError(res.error ?? "Couldn't remove the lien.");
    });
  };

  const errs = state.errors ?? {};

  return (
    <li className="flex flex-col gap-2 px-3 py-2 text-2xs">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-ink truncate">{lien.lienholder}</div>
          <div className="text-ink-4 mt-0.5">
            {lienTypeLabel(lien.lienholderType)} · {lienStatusLabel(lien.status)}
          </div>
        </div>
        <div className="text-right font-mono">
          <div className="text-ink">{formatMoney(lien.effectiveAmount)}</div>
          {lien.negotiatedAmount !== null &&
            lien.negotiatedAmount < lien.originalAmount && (
              <div className="text-2xs text-ink-4 line-through">
                {formatMoney(lien.originalAmount)}
              </div>
            )}
        </div>
        {canManage && !editing && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={openEditor}
              aria-label={`Edit lien ${lien.lienholder}`}
              className="inline-flex items-center justify-center w-6 h-6 rounded-md text-ink-4 hover:bg-paper-2 hover:text-ink"
            >
              <Pencil size={12} />
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              aria-label={`Remove lien ${lien.lienholder}`}
              className="inline-flex items-center justify-center w-6 h-6 rounded-md text-ink-4 hover:bg-paper-2 hover:text-warn disabled:opacity-50"
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>

      {deleteError && <div className="text-2xs text-warn">{deleteError}</div>}

      {canManage && editing && (
        <form
          action={formAction}
          className="flex flex-col gap-2 p-2 rounded-md border border-line bg-paper-2/40"
        >
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label
                htmlFor={`${uid}-negotiated`}
                className="text-2xs font-mono uppercase tracking-wider text-ink-4"
              >
                Negotiated amount
              </label>
              <input
                id={`${uid}-negotiated`}
                name="negotiatedAmount"
                type="text"
                inputMode="decimal"
                value={negotiated}
                placeholder={`Original ${lien.originalAmount.toFixed(2)}`}
                onChange={(e) => setNegotiated(e.target.value)}
                className={cn(inputClass, "font-mono", errs.negotiatedAmount && "border-warn")}
              />
              {errs.negotiatedAmount && (
                <span className="text-2xs text-warn">
                  {errs.negotiatedAmount[0]}
                </span>
              )}
              <span className="text-2xs text-ink-4">
                Leave blank to use the original amount; 0 records a write-off.
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <label
                htmlFor={`${uid}-status`}
                className="text-2xs font-mono uppercase tracking-wider text-ink-4"
              >
                Status
              </label>
              <select
                id={`${uid}-status`}
                name="status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className={inputClass}
              >
                {SETTLEMENT_LIEN_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {SETTLEMENT_LIEN_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {state.error && <div className="text-2xs text-warn">{state.error}</div>}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : "Save lien"}
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}

const inputClass =
  "h-8 px-2.5 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4";
