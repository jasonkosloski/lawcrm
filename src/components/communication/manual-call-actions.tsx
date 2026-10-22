/**
 * Manual Call Actions
 *
 * Kebab menu (Edit | Delete) rendered ONLY next to manually logged
 * call items — provider-synced items are immutable records and never
 * get this affordance (callers gate on `item.isManual` + the
 * permission flags passed down from the server component).
 *
 * Edit reuses the log-call composer (`CallLogDialog` in edit mode)
 * prefilled from the item; Delete asks for confirmation then calls the
 * `deleteCallLog` action. Same idioms as TimeEntryRowMenu.
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
import { deleteCallLog } from "@/app/actions/calls";
import type { EditableCallLog } from "@/lib/call-log-form";
import { confirmAction, notifyError } from "@/lib/feedback";
import { CallLogDialog, type CallMatterOption } from "./log-call-button";

export function ManualCallActions({
  item,
  canEdit,
  canDelete,
  matters = [],
}: {
  item: EditableCallLog;
  canEdit: boolean;
  canDelete: boolean;
  /** Open-matter options for the edit dialog's re-file select. */
  matters?: CallMatterOption[];
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!canEdit && !canDelete) return null;

  const onDelete = async () => {
    if (
      !(await confirmAction({
        title: `Delete this logged call with ${item.contactLabel}?`,
        description: "This can't be undone.",
        confirmLabel: "Delete call log",
        destructive: true,
      }))
    ) {
      return;
    }
    startTransition(async () => {
      try {
        const result = await deleteCallLog(item.id);
        if (!result.ok && result.error) {
          // Server refuses (e.g. provider-synced item) — surface why.
          notifyError(result.error);
        }
      } catch {
        // A thrown action must not swap the page for the error boundary.
        notifyError("Couldn't delete the call log - try again.");
      }
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label="Call log actions"
              disabled={pending}
              className="inline-flex items-center justify-center w-6 h-6 rounded-md text-ink-4 hover:bg-paper-2 hover:text-ink disabled:opacity-50"
            >
              <MoreHorizontal size={14} />
            </button>
          }
        />
        <DropdownMenuContent align="end" className="min-w-36">
          {canEdit && (
            <DropdownMenuItem onClick={() => setEditOpen(true)}>
              <Pencil />
              Edit
            </DropdownMenuItem>
          )}
          {canEdit && canDelete && <DropdownMenuSeparator />}
          {canDelete && (
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {canEdit && (
        <CallLogDialog open={editOpen} onOpenChange={setEditOpen} matters={matters} edit={item} />
      )}
    </>
  );
}
