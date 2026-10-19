/**
 * Expense Row Actions — kebab menu on every expense row: Edit
 * (`matters.expense.edit`) and Delete (`matters.expense.delete`).
 *
 * Both are hidden on rows already billed onto an invoice: the server
 * refuses edits/deletes there (the invoice's amounts would silently
 * drift), so the menu doesn't offer a dead end.
 */

"use client";

import { useState, useTransition } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteExpense } from "@/app/actions/expenses";
import { EditExpenseDialog, type EditableExpense } from "./edit-expense-dialog";
import type { ExpenseDocumentOption } from "./expense-fields";
import { confirmAction, notifyError } from "@/lib/feedback";

export function ExpenseRowActions({
  expense,
  isBilled,
  canEdit,
  canDelete,
  documentOptions = [],
}: {
  expense: EditableExpense;
  /** True when the expense has been linked onto an invoice. */
  isBilled: boolean;
  /** matters.expense.edit */
  canEdit: boolean;
  /** matters.expense.delete */
  canDelete: boolean;
  /** Receipt candidates for the edit dialog. */
  documentOptions?: ExpenseDocumentOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);

  // Nothing to render if there's no permitted action — the kebab
  // would just be visual noise.
  const showEdit = canEdit && !isBilled;
  const showDelete = canDelete && !isBilled;
  if (!showEdit && !showDelete) return null;

  const handleDelete = async () => {
    if (
      !(await confirmAction({
        title: `Delete expense "${expense.description}"?`,
        description:
          "This is permanent. The audit log keeps a record of the deletion.",
        confirmLabel: "Delete expense",
        destructive: true,
      }))
    )
      return;
    startTransition(async () => {
      const res = await deleteExpense(expense.id);
      if (!res.ok) notifyError(res.error ?? "Couldn't delete expense.");
    });
  };

  return (
    <>
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
          {showEdit && (
            <DropdownMenuItem onClick={() => setEditOpen(true)}>
              <Pencil />
              Edit expense
            </DropdownMenuItem>
          )}
          {showEdit && showDelete && <DropdownMenuSeparator />}
          {showDelete && (
            <DropdownMenuItem variant="destructive" onClick={handleDelete}>
              <Trash2 />
              Delete expense
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {showEdit && (
        <EditExpenseDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          expense={expense}
          documentOptions={documentOptions}
        />
      )}
    </>
  );
}
