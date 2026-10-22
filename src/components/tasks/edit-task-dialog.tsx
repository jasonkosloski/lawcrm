/**
 * Edit Task Dialog
 *
 * Modal form for editing a task's core fields — including the owner
 * via the shared AssigneeSelect. Reuses the same field primitives as
 * the TaskComposer so the edit experience matches create. Owner
 * changes post through `updateTask`, which applies the same
 * validation + "task_assigned" notification rules as setTaskOwner.
 *
 * Structure: this outer component stays mounted (TaskRowMenu renders
 * it unconditionally) and owns the action state; the form itself is a
 * child that only exists while the dialog is open, so its working
 * copy is seeded fresh on every open and a prop refresh while the
 * dialog is open can never wipe what the user has typed.
 *
 * Dates: `dueDateKey` is the date-only value as `YYYY-MM-DD`
 * (ADR-012) computed on the server with `dateOnlyKey`; it is never
 * turned into a `Date` in the browser, so no browser zone can shift it.
 */

"use client";

import { useEffect, useState, useTransition } from "react";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
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
import { TASK_STATUSES, TASK_STATUS_LABEL, type TaskStatus } from "@/lib/constants/task-status";
import { TASK_PRIORITIES, TASK_PRIORITY_LABEL, type TaskPriority } from "@/lib/constants/priority";
import { updateTask } from "@/app/actions/tasks";
import { updateTaskInitialState, type UpdateTaskFormState } from "@/lib/task-form";
import { AssigneeSelect, type AssigneeOption } from "@/components/tasks/assignee-select";

export type EditableTask = {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: TaskStatus;
  /** Current owner (null = unassigned) — seeds the assignee picker. */
  ownerId: string | null;
  /** Current owner's display data, so an owner who has since been
   *  deactivated (and so isn't in the picker's active list) still
   *  shows — and keeps — their assignment when the task is edited. */
  ownerName?: string | null;
  ownerInitials?: string | null;
  /**
   * Due date as `YYYY-MM-DD` (`dateOnlyKey(row.dueDate)`, computed on
   * the server) or "" when unset. A string on purpose: a `Date` read
   * with the browser's getters shows the previous day west of UTC.
   */
  dueDateKey: string;
  /** `row.updatedAt.toISOString()` — posted back so a save made from
   *  a stale form is refused instead of reverting someone else's edit. */
  updatedAt: string;
};

export function EditTaskDialog({
  open,
  onOpenChange,
  task,
  assignees,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: EditableTask;
  /** Active firm users for the assignee picker. */
  assignees: AssigneeOption[];
}) {
  const action = updateTask.bind(null, task.id);
  // Wrapped useActionState: masks state left over from a previous
  // open, so a failed attempt's field errors don't reappear when the
  // dialog is reopened. See src/hooks/use-dialog-action-state.ts.
  const [state, formAction, isPending] = useDialogActionState<UpdateTaskFormState, FormData>(
    action,
    updateTaskInitialState,
    open,
  );

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
          <DialogDescription>Update the title, due date, priority, or status.</DialogDescription>
        </DialogHeader>

        <EditTaskForm
          task={task}
          assignees={assignees}
          errors={state.errors ?? {}}
          formAction={formAction}
          isPending={isPending}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function EditTaskForm({
  task,
  assignees,
  errors: errs,
  formAction,
  isPending,
  onCancel,
}: {
  task: EditableTask;
  assignees: AssigneeOption[];
  errors: NonNullable<UpdateTaskFormState["errors"]>;
  formAction: (formData: FormData) => void;
  isPending: boolean;
  onCancel: () => void;
}) {
  // Working copy, seeded once per open (this component only exists
  // while the dialog is open).
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [dueDate, setDueDate] = useState(task.dueDateKey);
  const [priority, setPriority] = useState(task.priority);
  const [status, setStatus] = useState<TaskStatus>(task.status);
  // "" = the Unassigned option — posts as ownerId="" which the
  // action reads as "clear the owner" (tri-state; see updateTask).
  const [ownerId, setOwnerId] = useState(task.ownerId ?? "");
  // The row version this form was seeded from (see EditableTask).
  const [expectedUpdatedAt] = useState(task.updatedAt);

  // Manual dispatch instead of <form action>: React 19 resets the
  // form after the action settles — even on a validation error —
  // which would wipe what the user typed.
  const [, startSubmit] = useTransition();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startSubmit(() => formAction(fd));
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="expectedUpdatedAt" value={expectedUpdatedAt} />
      {errs._form?.[0] && (
        <div role="alert" className="text-xs text-destructive">
          {errs._form[0]}
        </div>
      )}

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
          ariaLabel="Priority"
          options={TASK_PRIORITIES.map((p) => ({
            value: p,
            label: TASK_PRIORITY_LABEL[p as TaskPriority],
          }))}
        />
      </div>

      <SelectField
        name="status"
        value={status}
        onChange={(v) => setStatus(v as TaskStatus)}
        ariaLabel="Status"
        options={TASK_STATUSES.map((s) => ({
          value: s,
          label: TASK_STATUS_LABEL[s],
        }))}
      />

      <AssigneeSelect
        value={ownerId}
        onChange={setOwnerId}
        assignees={assignees}
        currentOwner={
          task.ownerId
            ? {
                id: task.ownerId,
                name: task.ownerName ?? "Current assignee",
                initials: task.ownerInitials ?? "?",
              }
            : null
        }
        error={errs.ownerId?.[0]}
      />

      <TextareaField
        name="description"
        value={description}
        onChange={setDescription}
        placeholder="Details (optional)"
        rows={3}
        error={errs.description?.[0]}
        maxLength={4000}
      />

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}
