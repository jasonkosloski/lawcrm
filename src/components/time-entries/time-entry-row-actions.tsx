/**
 * Time Entry Row Actions
 *
 * Kebab menu: Edit | Set status > | Delete. Mark-billed lives inside
 * the status submenu — for the common case of "this is on the invoice
 * I just sent" the radio item is one click.
 */

"use client";

import { useState, useTransition } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  TIME_ENTRY_STATUSES,
  TIME_ENTRY_STATUS_LABEL as STATUS_LABEL,
  type TimeEntryStatus,
} from "@/lib/constants/time-entry-status";
import {
  deleteTimeEntry,
  setTimeEntryStatus,
} from "@/app/actions/time-entries";
import {
  EditTimeEntryDialog,
  type EditableTimeEntry,
} from "./edit-time-entry-dialog";

export function TimeEntryRowMenu({
  entry,
}: {
  entry: EditableTimeEntry;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const onSelectStatus = (next: string) => {
    if (next === entry.status) return;
    startTransition(async () => {
      await setTimeEntryStatus(entry.id, next as TimeEntryStatus);
    });
  };

  const onDelete = () => {
    if (
      !confirm(
        `Delete this time entry?\n\n"${entry.activity}" — ${entry.hours.toFixed(1)}h\n\nThis can't be undone.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await deleteTimeEntry(entry.id);
      if (!result.ok && result.error) {
        // Server refuses to delete a billed entry — surface that
        // verbatim so the user knows why.
        alert(result.error);
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
              aria-label="Time entry actions"
              disabled={pending}
              className="inline-flex items-center justify-center w-6 h-6 rounded-md text-ink-4 hover:bg-paper-2 hover:text-ink disabled:opacity-50"
            >
              <MoreHorizontal size={14} />
            </button>
          }
        />
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            <Pencil />
            Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Set status</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={entry.status}
              onValueChange={onSelectStatus}
            >
              {TIME_ENTRY_STATUSES.map((s) => (
                <DropdownMenuRadioItem key={s} value={s}>
                  {STATUS_LABEL[s]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditTimeEntryDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        entry={entry}
      />
    </>
  );
}
