/**
 * Expense Composer — primary expense form at the top of the
 * Expenses section on the matter Time tab. Two modes:
 *   collapsed → a slim "Log expense" button
 *   expanded  → the shared ExpenseFields (date / amount / description
 *               / category / utbms / notes + billable +
 *               client-advanced toggles + receipt)
 *
 * Uses `useActionState` so server-side validation errors surface
 * inline. On `status: "ok"` we reset the form back to its
 * collapsed state — the new row is already in the table via
 * revalidatePath in the action.
 */

"use client";

import { useState } from "react";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createExpense } from "@/app/actions/expenses";
import { useUserTimeZone } from "@/components/user-time-zone";
import { todayKey } from "@/lib/format-date";
import { expenseInitialState, type ExpenseFormState } from "@/lib/expense-constants";
import {
  ExpenseFields,
  blankExpenseDraft,
  type ExpenseDraft,
} from "./expense-fields";

export function ExpenseComposer({ matterId }: { matterId: string }) {
  const [expanded, setExpanded] = useState(false);
  const action = createExpense.bind(null, matterId);
  // Wrapped useActionState: masks state left over from a previous
  // expand, so a failed attempt's errors don't reappear when the
  // form is re-expanded. See src/hooks/use-dialog-action-state.ts.
  const [state, formAction, isPending] = useDialogActionState<
    ExpenseFormState,
    FormData
  >(action, expenseInitialState, expanded);

  // Default date = today in the viewer's profile zone. Expense.date is
  // a date-only value (ADR-012), so this is a calendar-day key, not an
  // instant. Lazy initializer: the clock is read once, not per render.
  const tz = useUserTimeZone();
  const [draft, setDraft] = useState<ExpenseDraft>(() => blankExpenseDraft(todayKey(tz)));
  const patch = (p: Partial<ExpenseDraft>) => setDraft((d) => ({ ...d, ...p }));

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
      setDraft(blankExpenseDraft(todayKey(tz)));
    }
  }

  if (!expanded) {
    return (
      <Button
        variant="outline"
        size="sm"
        type="button"
        onClick={() => setExpanded(true)}
      >
        <Plus size={12} />
        Log expense
      </Button>
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

      <ExpenseFields
        matterId={matterId}
        draft={draft}
        onChange={patch}
        errors={state.errors}
      />

      {state.error && <div className="text-2xs text-warn">{state.error}</div>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => setExpanded(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Logging…" : "Log expense"}
        </Button>
      </div>
    </form>
  );
}
