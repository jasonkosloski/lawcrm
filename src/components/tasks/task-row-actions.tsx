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
  type TaskStatus,
} from "@/lib/note-constants";
import { deleteTask, setTaskStatus } from "@/app/actions/tasks";
import { addTimeEntryToTask } from "@/app/actions/time-on-entity";
import { addNoteToTask } from "@/app/actions/note-on-entity";
import { EditTaskDialog, type EditableTask } from "./edit-task-dialog";
import { LogTimeOnEntityDialog } from "@/components/time-entries/log-time-on-entity-dialog";
import { AddNoteOnEntityDialog } from "@/components/notes/add-note-on-entity-dialog";
import { ConvertTaskToDeadlineDialog } from "@/components/conversions/convert-dialogs";

const STATUS_LABEL: Record<TaskStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  cancelled: "Cancelled",
};

export function TaskStatusToggle({
  taskId,
  status,
}: {
  taskId: string;
  status: TaskStatus;
}) {
  const [pending, startTransition] = useTransition();
  const done = status === "done" || status === "cancelled";
  const inProgress = status === "in_progress";

  const onClick = () => {
    const next: TaskStatus = done ? "open" : "done";
    startTransition(async () => {
      await setTaskStatus(taskId, next);
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-label={done ? "Reopen task" : "Mark task done"}
      title={done ? "Reopen task" : "Mark task done"}
      className={
        "inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border shrink-0 transition-colors " +
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
  );
}

export function TaskRowMenu({ task }: { task: EditableTask }) {
  const [editOpen, setEditOpen] = useState(false);
  const [logTimeOpen, setLogTimeOpen] = useState(false);
  const [addNoteOpen, setAddNoteOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const onSelectStatus = (next: string) => {
    if (next === task.status) return;
    startTransition(async () => {
      await setTaskStatus(task.id, next as TaskStatus);
    });
  };

  const onDelete = () => {
    if (
      !confirm(
        `Delete this task?\n\n"${task.title}"\n\nThis can't be undone.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      await deleteTask(task.id);
    });
  };

  return (
    <>
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
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            <Pencil />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setLogTimeOpen(true)}>
            <Clock />
            Log time on this task
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setAddNoteOpen(true)}>
            <MessageSquarePlus />
            Add note on this task
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setConvertOpen(true)}>
            <ArrowRight />
            Convert to deadline
          </DropdownMenuItem>
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
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditTaskDialog open={editOpen} onOpenChange={setEditOpen} task={task} />

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
        defaultDueDate={
          task.dueDate
            ? `${task.dueDate.getFullYear()}-${String(task.dueDate.getMonth() + 1).padStart(2, "0")}-${String(task.dueDate.getDate()).padStart(2, "0")}`
            : ""
        }
        defaultDescription={task.description ?? ""}
      />
    </>
  );
}
