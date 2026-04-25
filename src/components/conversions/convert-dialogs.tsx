/**
 * Convert dialogs — note → task, task → deadline.
 *
 * Both dialogs prefill from the source so the user just confirms +
 * fills any new required fields (deadline needs a due date that the
 * source task may not have). Submission creates the new entity with
 * the back-link FK set; the source entity is left intact.
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
  convertNoteToTask,
  convertTaskToDeadline,
} from "@/app/actions/conversions";
import {
  inboxActionInitialState,
  type InboxActionFormState,
} from "@/lib/inbox-action-form";
import {
  DEADLINE_KINDS,
  TASK_PRIORITIES,
} from "@/lib/note-constants";
import {
  DateField,
  SelectField,
  TextField,
  TextareaField,
} from "@/components/matters/captures/primary-fields";

// ── Note → Task ─────────────────────────────────────────────────────────

export function ConvertNoteToTaskDialog({
  open,
  onOpenChange,
  noteId,
  /** Prefill: typically the first line of plain-text note content. */
  defaultTitle,
  /** Prefill: the rest of the note as the task description. */
  defaultDescription,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noteId: string;
  defaultTitle: string;
  defaultDescription: string;
}) {
  const action = convertNoteToTask.bind(null, noteId);
  const [state, formAction, isPending] = useActionState<
    InboxActionFormState,
    FormData
  >(action, inboxActionInitialState);

  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState(defaultDescription);
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("normal");

  useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle);
    setDescription(defaultDescription);
    setDueDate("");
    setPriority("normal");
  }, [open, defaultTitle, defaultDescription]);

  useEffect(() => {
    if (state.status === "ok") onOpenChange(false);
  }, [state.status, onOpenChange]);

  const errs = state.errors ?? {};

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Convert note to task</DialogTitle>
          <DialogDescription>
            Creates a task linked back to this note. The note stays as-is.
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
              placeholder="Due date (optional)"
              error={errs.dueDate?.[0]}
            />
            <SelectField
              name="priority"
              value={priority}
              onChange={setPriority}
              options={TASK_PRIORITIES.map((p) => ({ value: p, label: p }))}
            />
          </div>

          <TextareaField
            name="description"
            value={description}
            onChange={setDescription}
            placeholder="Description (optional)"
            rows={5}
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
              {isPending ? "Converting…" : "Convert to task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Task → Deadline ─────────────────────────────────────────────────────

const KIND_LABEL: Record<string, string> = {
  critical: "Critical",
  auto_rule: "Auto-rule",
  manual: "Manual",
};

export function ConvertTaskToDeadlineDialog({
  open,
  onOpenChange,
  taskId,
  defaultTitle,
  /** Prefill from task.dueDate when the task already has one. */
  defaultDueDate,
  defaultDescription,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  defaultTitle: string;
  defaultDueDate: string;
  defaultDescription: string;
}) {
  const action = convertTaskToDeadline.bind(null, taskId);
  const [state, formAction, isPending] = useActionState<
    InboxActionFormState,
    FormData
  >(action, inboxActionInitialState);

  const [title, setTitle] = useState(defaultTitle);
  const [dueDate, setDueDate] = useState(defaultDueDate);
  const [kind, setKind] = useState<(typeof DEADLINE_KINDS)[number]>("manual");
  const [description, setDescription] = useState(defaultDescription);

  useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle);
    setDueDate(defaultDueDate);
    setKind("manual");
    setDescription(defaultDescription);
  }, [open, defaultTitle, defaultDueDate, defaultDescription]);

  useEffect(() => {
    if (state.status === "ok") onOpenChange(false);
  }, [state.status, onOpenChange]);

  const errs = state.errors ?? {};

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Convert task to deadline</DialogTitle>
          <DialogDescription>
            Creates a deadline linked back to this task. The task stays
            as-is — close it if it shouldn&apos;t live as a task too.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-3">
          <TextField
            name="title"
            value={title}
            onChange={setTitle}
            placeholder="Deadline title"
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
              name="kind"
              value={kind}
              onChange={(v) =>
                setKind(v as (typeof DEADLINE_KINDS)[number])
              }
              options={DEADLINE_KINDS.map((k) => ({
                value: k,
                label: KIND_LABEL[k] ?? k,
              }))}
            />
          </div>

          <TextareaField
            name="description"
            value={description}
            onChange={setDescription}
            placeholder="Why this deadline applies (optional)"
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
              {isPending ? "Converting…" : "Convert to deadline"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
