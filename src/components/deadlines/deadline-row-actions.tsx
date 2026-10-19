/**
 * Deadline Row Actions
 *
 * Kebab menu at the right edge of a deadline row. Edit | Set status >
 * | Delete. Status submenu only exposes user-driven states; `overdue`
 * is computed from dueDate at read time and isn't directly settable.
 *
 * Each item is shown only when the viewer holds the matching key
 * (`canEdit` = deadlines.edit, `canDelete` = deadlines.delete,
 * `canLogTime` = time_entries.create), resolved by the page — a denied
 * server action redirects to `/` and throws away what was typed.
 */

"use client";

import { useState, useTransition } from "react";
import { Clock, MessageSquarePlus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
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
  DEADLINE_STATUSES,
  DEADLINE_STATUS_LABEL as STATUS_LABEL,
  type DeadlineStatus,
} from "@/lib/constants/deadline-status";
import { deleteDeadline, setDeadlineStatus } from "@/app/actions/deadlines";
import { SOL_SOURCE_TYPE } from "@/lib/sol";
import { confirmAction } from "@/lib/feedback";
import { addTimeEntryToDeadline } from "@/app/actions/time-on-entity";
import {
  EditDeadlineDialog,
  type EditableDeadline,
} from "./edit-deadline-dialog";
import { LogTimeOnEntityDialog } from "@/components/time-entries/log-time-on-entity-dialog";
import { AddNoteOnEntityDialog } from "@/components/notes/add-note-on-entity-dialog";
import { addNoteToDeadline } from "@/app/actions/note-on-entity";

export function DeadlineRowMenu({
  deadline,
  canEdit,
  canDelete,
  canLogTime,
  canAddNote,
}: {
  deadline: EditableDeadline;
  canEdit: boolean;
  canDelete: boolean;
  canLogTime: boolean;
  /** notes.create — Add note on this deadline (addNoteToDeadline). */
  canAddNote: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [logTimeOpen, setLogTimeOpen] = useState(false);
  const [addNoteOpen, setAddNoteOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // The auto-managed SOL row can't be deleted or moved from here.
  const isSol = deadline.sourceType === SOL_SOURCE_TYPE;
  const showDelete = canDelete && !isSol;

  const onSelectStatus = (next: string) => {
    if (next === deadline.status) return;
    setError(null);
    startTransition(async () => {
      const res = await setDeadlineStatus(deadline.id, next as DeadlineStatus);
      if (!res.ok) setError(res.error ?? "Couldn't change the status.");
    });
  };

  const onDelete = async () => {
    if (
      !(await confirmAction({
        title: `Delete "${deadline.title}"?`,
        description: "This can't be undone.",
        confirmLabel: "Delete deadline",
        destructive: true,
      }))
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await deleteDeadline(deadline.id);
      if (!res.ok) setError(res.error ?? "Couldn't delete the deadline.");
    });
  };

  // Nothing this viewer may do -> no empty kebab.
  if (!canEdit && !showDelete && !canLogTime && !canAddNote) return null;

  return (
    <>
      {error && (
        <p role="alert" className="mb-1 max-w-56 text-2xs text-destructive">
          {error}
        </p>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label="Deadline actions"
              disabled={pending}
              className="inline-flex items-center justify-center w-6 h-6 rounded-md text-ink-4 hover:bg-paper-2 hover:text-ink disabled:opacity-50"
            >
              <MoreHorizontal size={14} />
            </button>
          }
        />
        <DropdownMenuContent align="end" className="min-w-44">
          {canEdit && (
            <DropdownMenuItem onClick={() => setEditOpen(true)}>
              <Pencil />
              Edit
            </DropdownMenuItem>
          )}
          {canLogTime && (
            <DropdownMenuItem onClick={() => setLogTimeOpen(true)}>
              <Clock />
              Log time on this deadline
            </DropdownMenuItem>
          )}
          {canAddNote && (
            <DropdownMenuItem onClick={() => setAddNoteOpen(true)}>
              <MessageSquarePlus />
              Add note on this deadline
            </DropdownMenuItem>
          )}
          {canEdit && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Set status</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={deadline.status}
                  onValueChange={onSelectStatus}
                >
                  {DEADLINE_STATUSES.map((s) => (
                    <DropdownMenuRadioItem key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </>
          )}
          {showDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <EditDeadlineDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        deadline={deadline}
      />

      <LogTimeOnEntityDialog
        open={logTimeOpen}
        onOpenChange={setLogTimeOpen}
        action={addTimeEntryToDeadline.bind(null, deadline.id)}
        parentLabel={deadline.title}
        parentKind="deadline"
      />

      <AddNoteOnEntityDialog
        open={addNoteOpen}
        onOpenChange={setAddNoteOpen}
        action={addNoteToDeadline.bind(null, deadline.id)}
        parentLabel={deadline.title}
        parentKind="deadline"
      />
    </>
  );
}
