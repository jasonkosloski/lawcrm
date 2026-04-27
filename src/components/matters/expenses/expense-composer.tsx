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

import { useActionState, useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { createExpense } from "@/app/actions/expenses";
import {
  expenseInitialState,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABEL,
  type ExpenseFormState,
} from "@/lib/expense-constants";

const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function ExpenseComposer({ matterId }: { matterId: string }) {
  const action = createExpense.bind(null, matterId);
  const [state, formAction, isPending] = useActionState<
    ExpenseFormState,
    FormData
  >(action, expenseInitialState);

  const [expanded, setExpanded] = useState(false);
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] =
    useState<(typeof EXPENSE_CATEGORIES)[number]>("filing_fee");
  const [utbmsCode, setUtbmsCode] = useState("");
  const [billable, setBillable] = useState(true);
  const [clientAdvanced, setClientAdvanced] = useState(false);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (state.status === "ok") {
      // Reset the form to collapsed state. The action revalidated
      // the page so the new row already shows in the table below.
      setExpanded(false);
      setAmount("");
      setDescription("");
      setUtbmsCode("");
      setNotes("");
      setBillable(true);
      setClientAdvanced(false);
      setDate(todayIso());
      setCategory("filing_fee");
    }
  }, [state.status]);

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
        <Field label="Date" required>
          <input
            name="date"
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={cn(inputClass, errs.date && "border-warn")}
          />
          {errs.date && <FieldError>{errs.date[0]}</FieldError>}
        </Field>
        <Field label="Amount" required>
          <input
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
        <Field label="Category">
          <select
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

      <Field label="Description" required>
        <input
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
        <Field label="UTBMS code">
          <input
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

      <Field label="Notes">
        <textarea
          name="notes"
          rows={2}
          maxLength={1000}
          value={notes}
          placeholder="Optional context for the bill or audit trail"
          onChange={(e) => setNotes(e.target.value)}
          className="px-2.5 py-1.5 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4 resize-none"
        />
      </Field>

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
