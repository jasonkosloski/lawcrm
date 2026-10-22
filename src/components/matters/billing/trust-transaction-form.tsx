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

import { useCallback, useId, useState, useTransition } from "react";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
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
import { todayKey } from "@/lib/format-date";
import { useUserTimeZone } from "@/components/user-time-zone";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { inputClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export function TrustTransactionForm({
  matterId,
  portalBillingEnabled = false,
}: {
  matterId: string;
  /** When the client sees billing in the portal, descriptions are client-visible. */
  portalBillingEnabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [type, setType] = useState<TrustTxnType>("deposit");
  // Date input default: the viewer's today (their profile zone),
  // captured when the form opens — never read during render.
  const tz = useUserTimeZone();
  const [defaultDate, setDefaultDate] = useState("");
  const ids = useId();
  // Collapse + reset on success, from inside the action wrapper: it
  // runs once per invocation, so every success collapses the form
  // (an effect keyed on `state.status` would not re-fire — the
  // status stays "ok" — and one keyed on the state object needs a
  // setState inside an effect).
  const action = useCallback(
    async (prev: BillingFormState, formData: FormData) => {
      const res = await addTrustTransaction(matterId, prev, formData);
      if (res.status === "ok") {
        setExpanded(false);
        setType("deposit");
      }
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

  if (!expanded) {
    return (
      <Button
        variant="outline"
        size="sm"
        type="button"
        onClick={() => {
          setDefaultDate(todayKey(tz));
          setExpanded(true);
        }}
        className="gap-2 border-dashed"
      >
        <Plus size={12} />
        Add transaction
      </Button>
    );
  }

  const errs = state.errors ?? {};

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 p-3 rounded-md border border-line bg-paper-2/40"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label
            htmlFor={`${ids}-type`}
            className="text-2xs font-medium text-ink-3"
          >
            Type <span className="text-warn">*</span>
          </label>
          <NativeSelect
            className="w-full"
            id={`${ids}-type`}
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value as TrustTxnType)}
          >
            {TRUST_TXN_TYPES.map((t) => (
              <NativeSelectOption key={t} value={t}>
                {TRUST_TXN_TYPE_LABEL[t]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor={`${ids}-amount`}
            className="text-2xs font-medium text-ink-3"
          >
            Amount <span className="text-warn">*</span>
          </label>
          <input
            id={`${ids}-amount`}
            name="amount"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            required
            className={cn(inputClass(!!errs.amount), "font-mono")}
          />
          {errs.amount && (
            <span className="text-2xs text-warn">{errs.amount[0]}</span>
          )}
        </div>
        <div className="flex flex-col gap-1 col-span-2">
          <label
            htmlFor={`${ids}-description`}
            className="text-2xs font-medium text-ink-3"
          >
            Description <span className="text-warn">*</span>
          </label>
          <input
            id={`${ids}-description`}
            name="description"
            type="text"
            required
            maxLength={400}
            placeholder="e.g. Initial retainer · check #4421"
            className={inputClass(!!errs.description)}
          />
          {errs.description && (
            <span className="text-2xs text-warn">{errs.description[0]}</span>
          )}
          {portalBillingEnabled && (
            <span className="text-2xs text-ink-3">
              Descriptions are visible to the client in the portal.
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor={`${ids}-reference`}
            className="text-2xs font-medium text-ink-3"
          >
            Reference
          </label>
          <input
            id={`${ids}-reference`}
            name="reference"
            type="text"
            placeholder="Check #, wire ID, etc."
            maxLength={120}
            className={inputClass()}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor={`${ids}-date`}
            className="text-2xs font-medium text-ink-3"
          >
            Date
          </label>
          <input
            id={`${ids}-date`}
            name="date"
            type="date"
            defaultValue={defaultDate}
            className={inputClass()}
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
        <Button
          size="sm"
          type="submit"
          disabled={isPending}
        >
          {isPending ? "Recording…" : "Record transaction"}
        </Button>
      </div>
    </form>
  );
}
