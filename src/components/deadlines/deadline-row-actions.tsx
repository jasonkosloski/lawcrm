/**
 * Deadline Row Actions
 *
 * Kebab menu at the right edge of a deadline row. Edit | Set status >
 * | Delete. Status submenu only exposes user-driven states; `overdue`
 * is computed from dueDate at read time and isn't directly settable.
 */

"use client";

import { useState, useTransition } from "react";
import { Clock, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
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
import { addTimeEntryToDeadline } from "@/app/actions/time-on-entity";
import {
  EditDeadlineDialog,
  type EditableDeadline,
} from "./edit-deadline-dialog";
import { LogTimeOnEntityDialog } from "@/components/time-entries/log-time-on-entity-dialog";

export function DeadlineRowMenu({
  deadline,
}: {
  deadline: EditableDeadline;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [logTimeOpen, setLogTimeOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const onSelectStatus = (next: string) => {
    if (next === deadline.status) return;
    startTransition(async () => {
      await setDeadlineStatus(deadline.id, next as DeadlineStatus);
    });
  };

  const onDelete = () => {
    if (
      !confirm(
        `Delete this deadline?\n\n"${deadline.title}"\n\nThis can't be undone.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      await deleteDeadline(deadline.id);
    });
  };

  return (
    <>
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
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            <Pencil />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setLogTimeOpen(true)}>
            <Clock />
            Log time on this deadline
          </DropdownMenuItem>
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
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 />
            Delete
          </DropdownMenuItem>
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
    </>
  );
}
