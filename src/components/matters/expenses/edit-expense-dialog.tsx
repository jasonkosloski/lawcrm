/**
 * Edit expense — `updateExpense` (gated `matters.expense.edit`).
 *
 * Same fields as the composer (shared ExpenseFields). Seeded from the
 * server-shaped row on every open — the date arrives as a day key
 * (`dateOnlyKey`), the amount as a fixed-2 string — so nothing is
 * converted through a browser Date (ADR-012). Billed expenses are
 * never offered (the row hides Edit; the action refuses them too).
 */

"use client";

import { useEffect, useState } from "react";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { updateExpense } from "@/app/actions/expenses";
import { expenseInitialState, type ExpenseFormState } from "@/lib/expense-constants";
import {
  ExpenseFields,
  type ExpenseDocumentOption,
  type ExpenseDraft,
} from "./expense-fields";

/** The editable shape the server hands the row. */
export type EditableExpense = ExpenseDraft & { id: string };

export function EditExpenseDialog({
  open,
  onOpenChange,
  expense,
  documentOptions = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense: EditableExpense;
  documentOptions?: ExpenseDocumentOption[];
}) {
  const [state, formAction, isPending] = useDialogActionState<ExpenseFormState, FormData>(
    updateExpense.bind(null, expense.id),
    expenseInitialState,
    open
  );
  const [draft, setDraft] = useState<ExpenseDraft>(expense);
  const patch = (p: Partial<ExpenseDraft>) => setDraft((d) => ({ ...d, ...p }));

  // Reseed from the saved row on every open (render-phase reset).
  const [prevOpen, setPrevOpen] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setDraft(expense);
  }

  useEffect(() => {
    if (state.status === "ok") onOpenChange(false);
  }, [state, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit expense</DialogTitle>
          <DialogDescription>
            The change is recorded on the matter&apos;s timeline (amount
            changes include the old and new amounts).
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-3">
          <ExpenseFields
            draft={draft}
            onChange={patch}
            errors={state.errors}
            documentOptions={documentOptions}
          />
          {state.error && <div className="text-2xs text-warn">{state.error}</div>}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "Saving…" : "Save expense"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
