/**
 * Task Row Actions
 *
 * The bits at the right edge of a task row in the matter Tasks tab:
 *   - status toggle (the colored circle that doubles as a "mark done" button)
 *   - kebab menu with Edit + per-status sub-items + Delete
 *
 * The status toggle is the main quick-action — single click cycles
 * open ↔ done. The menu exposes the full status list for users who
 * want to set in_progress / in_review / cancelled without opening the
 * edit dialog.
 *
 * Server-side mutations live in `src/app/actions/tasks.ts`.
 *
 * Controls are shown only when the viewer holds the matching key
 * (resolved by the page and passed as `can*` props) — a denied server
 * action redirects to `/` and throws away whatever the user typed. A
 * refused action (task already deleted, etc.) shows the server's
 * message instead of failing silently.
 */

"use client";

import { useState, useTransition } from "react";
import {
  ArrowRight,
  Check,
  Clock,
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
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
  TASK_STATUSES,
  TASK_STATUS_LABEL as STATUS_LABEL,
  type TaskStatus,
} from "@/lib/constants/task-status";
import { confirmAction } from "@/lib/feedback";
import { deleteTask, setTaskStatus } from "@/app/actions/tasks";
import { addTimeEntryToTask } from "@/app/actions/time-on-entity";
import { addNoteToTask } from "@/app/actions/note-on-entity";
import { EditTaskDialog, type EditableTask } from "./edit-task-dialog";
import type { AssigneeOption } from "./assignee-select";
import { LogTimeOnEntityDialog } from "@/components/time-entries/log-time-on-entity-dialog";
import { AddNoteOnEntityDialog } from "@/components/notes/add-note-on-entity-dialog";
import { ConvertTaskToDeadlineDialog } from "@/components/conversions/convert-dialogs";

export function TaskStatusToggle({
  taskId,
  status,
  canEdit,
}: {
  taskId: string;
  status: TaskStatus;
  /** tasks.edit — without it the circle is a read-only indicator. */
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const done = status === "done" || status === "cancelled";
  const inProgress = status === "in_progress";

  const onClick = () => {
    const next: TaskStatus = done ? "open" : "done";
    setError(null);
    startTransition(async () => {
      const res = await setTaskStatus(taskId, next);
      if (!res.ok) setError(res.error ?? "Couldn't change the status.");
    });
  };

  const circle =
    "inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border shrink-0 ";

  if (!canEdit) {
    return (
      <span
        aria-hidden="true"
        className={
          circle +
          (done ? "bg-ok border-ok text-white" : "border-line")
        }
      >
        {done ? <Check size={10} strokeWidth={3} /> : null}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        aria-label={done ? "Reopen task" : "Mark task done"}
        title={done ? "Reopen task" : "Mark task done"}
        className={
          circle +
          "transition-colors " +
          (pending
            ? "border-line bg-paper-2 cursor-wait"
            : done
              ? "bg-ok border-ok text-white hover:opacity-80"
              : inProgress
                ? "border-brand-500 bg-brand-50 hover:bg-brand-100"
                : "border-line hover:border-brand-500 hover:bg-brand-50")
        }
      >
        {done ? (
          <Check size={10} strokeWidth={3} />
        ) : pending ? (
          <Loader2 size={9} className="animate-spin" />
        ) : null}
      </button>
      {error && (
        <span role="alert" className="text-2xs text-destructive">
          {error}
        </span>
      )}
    </>
  );
}

export function TaskRowMenu({
  task,
  assignees,
  canEdit,
  canDelete,
  canLogTime,
  canAddNote,
  canConvert,
}: {
  task: EditableTask;
  /** Active firm users — threaded through to the edit dialog's
   *  assignee picker. */
  assignees: AssigneeOption[];
  /** tasks.edit — Edit and Set status. */
  canEdit: boolean;
  /** tasks.delete. */
  canDelete: boolean;
  /** time_entries.create — Log time on this task. */
  canLogTime: boolean;
  /** notes.create — Add note on this task. */
  canAddNote: boolean;
  /** deadlines.create — Convert to deadline. */
  canConvert: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [logTimeOpen, setLogTimeOpen] = useState(false);
  const [addNoteOpen, setAddNoteOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onSelectStatus = (next: string) => {
    if (next === task.status) return;
    setError(null);
    startTransition(async () => {
      const res = await setTaskStatus(task.id, next as TaskStatus);
      if (!res.ok) setError(res.error ?? "Couldn't change the status.");
    });
  };

  const onDelete = async () => {
    if (
      !(await confirmAction({
        title: `Delete "${task.title}"?`,
        description: "This can't be undone.",
        confirmLabel: "Delete task",
        destructive: true,
      }))
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await deleteTask(task.id);
      if (!res.ok) setError(res.error ?? "Couldn't delete the task.");
    });
  };

  // Nothing this viewer may do -> no empty kebab.
  if (!canEdit && !canDelete && !canLogTime && !canAddNote && !canConvert) {
    return null;
  }

  return (
    <>
      {error && (
        <p role="alert" className="max-w-40 text-2xs text-destructive">
          {error}
        </p>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label="Task actions"
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
              Log time on this task
            </DropdownMenuItem>
          )}
          {canAddNote && (
            <DropdownMenuItem onClick={() => setAddNoteOpen(true)}>
              <MessageSquarePlus />
              Add note on this task
            </DropdownMenuItem>
          )}
          {canConvert && (
            <DropdownMenuItem onClick={() => setConvertOpen(true)}>
              <ArrowRight />
              Convert to deadline
            </DropdownMenuItem>
          )}
          {canEdit && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Set status</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={task.status}
                  onValueChange={onSelectStatus}
                >
                  {TASK_STATUSES.map((s) => (
                    <DropdownMenuRadioItem key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </>
          )}
          {canDelete && (
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

      <EditTaskDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        task={task}
        assignees={assignees}
      />

      <LogTimeOnEntityDialog
        open={logTimeOpen}
        onOpenChange={setLogTimeOpen}
        action={addTimeEntryToTask.bind(null, task.id)}
        parentLabel={task.title}
        parentKind="task"
      />

      <AddNoteOnEntityDialog
        open={addNoteOpen}
        onOpenChange={setAddNoteOpen}
        action={addNoteToTask.bind(null, task.id)}
        parentLabel={task.title}
        parentKind="task"
      />

      <ConvertTaskToDeadlineDialog
        open={convertOpen}
        onOpenChange={setConvertOpen}
        taskId={task.id}
        defaultTitle={task.title}
        defaultDueDate={task.dueDateKey}
        defaultDescription={task.description ?? ""}
      />
    </>
  );
}
