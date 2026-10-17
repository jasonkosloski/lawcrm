/**
 * Expense Composer — primary expense form at the top of the
 * Expenses section on the matter Time tab. Two modes:
 *   collapsed → a slim "Log expense" button
 *   expanded  → full form with date / amount / description /
 *               category / utbms / notes + billable +
 *               client-advanced toggles
 *
 * Uses `useActionState` so server-side validation errors surface
 * inline. On `status: "ok"` we reset the form back to its
 * collapsed state — the new row is already in the table via
 * revalidatePath in the action.
 */

"use client";

import { useId, useState } from "react";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { createExpense } from "@/app/actions/expenses";
import { useUserTimeZone } from "@/components/user-time-zone";
import { todayKey } from "@/lib/format-date";
import {
  expenseInitialState,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABEL,
  type ExpenseFormState,
} from "@/lib/expense-constants";

export type ExpenseDocumentOption = {
  id: string;
  name: string;
};

export function ExpenseComposer({
  matterId,
  documentOptions = [],
}: {
  matterId: string;
  /** Documents on this matter, surfaced as receipt options in the
   *  dropdown. Empty list (the default) hides the receipt field. */
  documentOptions?: ExpenseDocumentOption[];
}) {
  const [expanded, setExpanded] = useState(false);
  const action = createExpense.bind(null, matterId);
  // Wrapped useActionState: masks state left over from a previous
  // expand, so a failed attempt's errors don't reappear when the
  // form is re-expanded. See src/hooks/use-dialog-action-state.ts.
  const [state, formAction, isPending] = useDialogActionState<
    ExpenseFormState,
    FormData
  >(action, expenseInitialState, expanded);

  const uid = useId();
  // Default date = today in the viewer's profile zone. Expense.date is
  // a date-only value (ADR-012), so this is a calendar-day key, not an
  // instant. Lazy initializer: the clock is read once, not per render.
  const tz = useUserTimeZone();
  const [date, setDate] = useState(() => todayKey(tz));
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] =
    useState<(typeof EXPENSE_CATEGORIES)[number]>("filing_fee");
  const [utbmsCode, setUtbmsCode] = useState("");
  const [billable, setBillable] = useState(true);
  const [clientAdvanced, setClientAdvanced] = useState(false);
  const [notes, setNotes] = useState("");
  const [receiptDocumentId, setReceiptDocumentId] = useState("");

  // Reset + collapse when a submission succeeds. The action already
  // revalidated the page, so the new row shows in the table below.
  // Adjusts state during render (React's "you might not need an
  // effect" pattern), keyed on the state OBJECT, not state.status:
  // useActionState keeps its state across submissions, so after the
  // first success the status string is "ok" forever and a second
  // success would be missed. Each action invocation returns a fresh
  // object, so identity is the reliable signal.
  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    if (state.status === "ok") {
      setExpanded(false);
      setAmount("");
      setDescription("");
      setUtbmsCode("");
      setNotes("");
      setReceiptDocumentId("");
      setBillable(true);
      setClientAdvanced(false);
      setDate(todayKey(tz));
      setCategory("filing_fee");
    }
  }

  const errs = state.errors ?? {};

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-line bg-white text-xs text-ink hover:border-brand-300 hover:text-brand-700 transition-colors"
      >
        <Plus size={12} />
        Log expense
      </button>
    );
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 p-4 rounded-md border border-line bg-paper"
    >
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-ink">Log expense</div>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-label="Cancel"
          className="text-ink-4 hover:text-ink"
        >
          <X size={14} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Date" htmlFor={`${uid}-date`} required>
          <input
            id={`${uid}-date`}
            name="date"
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={cn(inputClass, errs.date && "border-warn")}
          />
          {errs.date && <FieldError>{errs.date[0]}</FieldError>}
        </Field>
        <Field label="Amount" htmlFor={`${uid}-amount`} required>
          <input
            id={`${uid}-amount`}
            name="amount"
            type="text"
            inputMode="decimal"
            required
            value={amount}
            placeholder="0.00"
            onChange={(e) => setAmount(e.target.value)}
            className={cn(
              inputClass,
              "font-mono",
              errs.amount && "border-warn"
            )}
          />
          {errs.amount && <FieldError>{errs.amount[0]}</FieldError>}
        </Field>
        <Field label="Category" htmlFor={`${uid}-category`}>
          <select
            id={`${uid}-category`}
            name="category"
            value={category}
            onChange={(e) =>
              setCategory(
                e.target.value as (typeof EXPENSE_CATEGORIES)[number]
              )
            }
            className={inputClass}
          >
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {EXPENSE_CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Description" htmlFor={`${uid}-description`} required>
        <input
          id={`${uid}-description`}
          name="description"
          type="text"
          required
          maxLength={400}
          value={description}
          placeholder="Court filing fee — motion to compel"
          onChange={(e) => setDescription(e.target.value)}
          className={cn(inputClass, errs.description && "border-warn")}
        />
        {errs.description && <FieldError>{errs.description[0]}</FieldError>}
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <Field label="UTBMS code" htmlFor={`${uid}-utbms`}>
          <input
            id={`${uid}-utbms`}
            name="utbmsCode"
            type="text"
            maxLength={20}
            value={utbmsCode}
            placeholder="E.g. E102"
            onChange={(e) => setUtbmsCode(e.target.value)}
            className={inputClass}
          />
        </Field>
        <label className="flex items-center gap-2 text-xs text-ink mt-5">
          <input
            type="checkbox"
            name="billable"
            checked={billable}
            onChange={(e) => setBillable(e.target.checked)}
          />
          Billable
        </label>
        <label className="flex items-center gap-2 text-xs text-ink mt-5">
          <input
            type="checkbox"
            name="clientAdvanced"
            checked={clientAdvanced}
            onChange={(e) => setClientAdvanced(e.target.checked)}
          />
          Client advanced
        </label>
      </div>

      <Field label="Notes" htmlFor={`${uid}-notes`}>
        <textarea
          id={`${uid}-notes`}
          name="notes"
          rows={2}
          maxLength={1000}
          value={notes}
          placeholder="Optional context for the bill or audit trail"
          onChange={(e) => setNotes(e.target.value)}
          className="px-2.5 py-1.5 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4 resize-none"
        />
      </Field>

      {/* Receipt picker — only renders when the matter actually
          has documents to pick from. Upload a receipt via the
          Documents tab first, then attach it here. */}
      {documentOptions.length > 0 && (
        <Field label="Receipt" htmlFor={`${uid}-receipt`}>
          <select
            id={`${uid}-receipt`}
            name="receiptDocumentId"
            value={receiptDocumentId}
            onChange={(e) => setReceiptDocumentId(e.target.value)}
            className={inputClass}
          >
            <option value="">— No receipt —</option>
            {documentOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {state.error && (
        <div className="text-2xs text-warn">{state.error}</div>
      )}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => setExpanded(false)}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Logging…" : "Log expense"}
        </Button>
      </div>
    </form>
  );
}

const inputClass =
  "h-8 px-2.5 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4";

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  /** id of the control this label names. */
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={htmlFor}
        className="text-2xs font-mono uppercase tracking-wider text-ink-4"
      >
        {label} {required && <span className="text-warn">*</span>}
      </label>
      {children}
    </div>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return <span className="text-2xs text-warn">{children}</span>;
}
