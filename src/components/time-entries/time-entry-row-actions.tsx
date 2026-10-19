/**
 * Time Entry Row Actions
 *
 * Kebab menu: Edit | Set status > | Delete.
 *
 * "Billed" is NOT a status a user can pick: invoice generation sets
 * it (together with the invoice link) and voiding the invoice clears
 * it, so the radio item is shown disabled unless it is already the
 * entry's status. Billed entries are locked — their hours are baked
 * into an invoice — so every action is disabled for them, and the
 * server's refusals (`{ ok: false, error }`) are always surfaced
 * rather than letting the menu snap back silently.
 *
 * `canEdit` / `canDelete` come from the page (author OR the matching
 * `time_entries.*_any` permission). They only decide what to SHOW;
 * the server actions remain the real gate. When the viewer can do
 * neither, no menu renders at all.
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
import { formatHours } from "@/lib/time-entry-constants";
import { confirmAction, notifyError } from "@/lib/feedback";
import {
  EditTimeEntryDialog,
  type EditableTimeEntry,
} from "./edit-time-entry-dialog";

export function TimeEntryRowMenu({
  entry,
  canEdit = true,
  canDelete = true,
}: {
  entry: EditableTimeEntry;
  /** Viewer is the entry's author or holds `time_entries.edit_any`. */
  canEdit?: boolean;
  /** Viewer is the entry's author or holds `time_entries.delete_any`. */
  canDelete?: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const locked = entry.status === "billed";

  const onSelectStatus = (next: string) => {
    if (next === entry.status) return;
    startTransition(async () => {
      const result = await setTimeEntryStatus(
        entry.id,
        next as TimeEntryStatus
      );
      // The radio group is controlled by entry.status, so a refusal
      // just snaps back — say why (billed by invoice generation,
      // still on an invoice, changed in another tab…).
      if (!result.ok && result.error) notifyError(result.error);
    });
  };

  const onDelete = async () => {
    if (
      !(await confirmAction({
        title: "Delete this time entry?",
        description: `"${entry.activity}" — ${formatHours(entry.hours)}h. This can't be undone.`,
        confirmLabel: "Delete time entry",
        destructive: true,
      }))
    ) {
      return;
    }
    startTransition(async () => {
      const result = await deleteTimeEntry(entry.id);
      if (!result.ok && result.error) {
        // Server refuses to delete a billed entry — surface that
        // verbatim so the user knows why.
        notifyError(result.error);
      }
    });
  };

  if (!canEdit && !canDelete) return null;

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
          {canEdit && (
            <>
              <DropdownMenuItem
                disabled={locked}
                onClick={() => setEditOpen(true)}
              >
                <Pencil />
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>
                  {locked ? "Status (on an invoice)" : "Set status"}
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={entry.status}
                  onValueChange={onSelectStatus}
                >
                  {TIME_ENTRY_STATUSES.map((s) => (
                    <DropdownMenuRadioItem
                      key={s}
                      value={s}
                      // Only invoice generation sets "billed"; a
                      // billed entry's status moves via its invoice.
                      disabled={
                        locked || (s === "billed" && entry.status !== "billed")
                      }
                    >
                      {STATUS_LABEL[s]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </>
          )}
          {canEdit && canDelete && <DropdownMenuSeparator />}
          {canDelete && (
            <DropdownMenuItem
              variant="destructive"
              disabled={locked}
              onClick={onDelete}
            >
              <Trash2 />
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {canEdit && (
        <EditTimeEntryDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          entry={entry}
        />
      )}
    </>
  );
}
