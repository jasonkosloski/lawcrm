/**
 * Edit Task Dialog
 *
 * Modal form for editing a task's core fields. Reuses the same field
 * primitives as the TaskComposer so the edit experience matches create.
 *
 * Owner reassignment is intentionally not exposed in v1 — there's no
 * team-picker component yet. Surfaces as an open follow-up in
 * docs/FEATURES.md (matter team editor).
 */

"use client";

import { useActionState, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  DateField,
  SelectField,
  TextField,
  TextareaField,
} from "@/components/matters/captures/primary-fields";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskStatus,
} from "@/lib/note-constants";
import { updateTask } from "@/app/actions/tasks";
import {
  updateTaskInitialState,
  type UpdateTaskFormState,
} from "@/lib/task-form";

export type EditableTask = {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: TaskStatus;
  /**
   * Due date as a `Date` (or null when unset) — NOT a pre-formatted
   * string. The dialog converts it to the input's `YYYY-MM-DD` value via
   * `toDateInput`, which reads local date components (see below).
   */
  dueDate: Date | null;
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  cancelled: "Cancelled",
};

/** Convert a Date to the `YYYY-MM-DD` format the date input expects. */
const toDateInput = (d: Date | null): string => {
  if (!d) return "";
  // Use local-date components so a date stored at midnight UTC doesn't
  // show as the previous day in negative-offset timezones.
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

export function EditTaskDialog({
  open,
  onOpenChange,
  task,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: EditableTask;
}) {
  const action = updateTask.bind(null, task.id);
  const [state, formAction, isPending] = useActionState<
    UpdateTaskFormState,
    FormData
  >(action, updateTaskInitialState);

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [dueDate, setDueDate] = useState(toDateInput(task.dueDate));
  const [priority, setPriority] = useState(task.priority);
  const [status, setStatus] = useState<TaskStatus>(task.status);

  // Field errors are mirrored into local state rather than read straight
  // off `state.errors`: useActionState has no reset, and this component
  // stays mounted across close/reopen (TaskRowMenu renders it
  // unconditionally), so errors from a prior failed attempt would
  // otherwise reappear on the next open even though the fields reset.
  const [errs, setErrs] = useState<
    NonNullable<UpdateTaskFormState["errors"]>
  >({});
  useEffect(() => {
    setErrs(state.errors ?? {});
  }, [state]);

  // Reset local state whenever the dialog opens with a fresh task.
  useEffect(() => {
    if (open) {
      setTitle(task.title);
      setDescription(task.description ?? "");
      setDueDate(toDateInput(task.dueDate));
      setPriority(task.priority);
      setStatus(task.status);
      setErrs({});
    }
  }, [open, task]);

  // Auto-close on successful save. Deps must be the state OBJECT, not
  // `state.status`: useActionState keeps its state across submissions,
  // and this component stays mounted between opens, so after the first
  // success the status string is "ok" forever — keyed on the string, a
  // second save's fresh state object compares equal and the effect never
  // re-fires, leaving the dialog silently open. Object identity is the
  // reliable "a submission just finished" signal (same fix as
  // RecordPaymentDialog).
  useEffect(() => {
    if (state.status === "ok") onOpenChange(false);
  }, [state, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit task</DialogTitle>
          <DialogDescription>
            Update the title, due date, priority, or status.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-3">
          <TextField
            name="title"
            value={title}
            onChange={setTitle}
            placeholder="Task title"
            error={errs.title?.[0]}
            autoFocus
          />

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <DateField
              name="dueDate"
              value={dueDate}
              onChange={setDueDate}
              placeholder="Due date"
              error={errs.dueDate?.[0]}
            />
            <SelectField
              name="priority"
              value={priority}
              onChange={setPriority}
              options={TASK_PRIORITIES.map((p) => ({ value: p, label: p }))}
            />
          </div>

          <SelectField
            name="status"
            value={status}
            onChange={(v) => setStatus(v as TaskStatus)}
            options={TASK_STATUSES.map((s) => ({
              value: s,
              label: STATUS_LABEL[s],
            }))}
          />

          <TextareaField
            name="description"
            value={description}
            onChange={setDescription}
            placeholder="Details (optional)"
            rows={3}
            error={errs.description?.[0]}
          />

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
