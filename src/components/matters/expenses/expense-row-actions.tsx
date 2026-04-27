/**
 * Expense Row Actions — kebab menu on every expense row.
 *
 * Today: Delete only. Server refuses delete on rows that have
 * been billed onto an invoice (the FK is set), so the action
 * naturally guards against accidental data loss after an invoice
 * has gone out.
 *
 * Edit-in-place is the next round (UI exists in the action layer
 * via `updateExpense` — we just need the dialog).
 */

"use client";

import { useTransition } from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteExpense } from "@/app/actions/expenses";

export function ExpenseRowActions({
  expenseId,
  description,
  isBilled,
  canDelete,
}: {
  expenseId: string;
  description: string;
  /** True when the expense has been linked onto an invoice. The
   *  server refuses the delete in that case; we hide the menu
   *  item entirely so the user doesn't see a dead-end action. */
  isBilled: boolean;
  /** True when the current user holds `matters.expense.delete`. */
  canDelete: boolean;
}) {
  const [pending, startTransition] = useTransition();

  // Nothing to render if there's no permitted action — the kebab
  // would just be visual noise.
  const showDelete = canDelete && !isBilled;
  if (!showDelete) return null;

  const handleDelete = () => {
    if (
      !confirm(
        `Delete expense "${description}"? This is permanent. The audit log keeps a record of the deletion.`
      )
    )
      return;
    startTransition(async () => {
      const res = await deleteExpense(expenseId);
      if (!res.ok) alert(res.error ?? "Couldn't delete expense.");
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Expense actions"
            disabled={pending}
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-4 hover:bg-paper-2 hover:text-ink disabled:opacity-50"
          >
            <MoreHorizontal size={14} />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem variant="destructive" onClick={handleDelete}>
          <Trash2 />
          Delete expense
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
