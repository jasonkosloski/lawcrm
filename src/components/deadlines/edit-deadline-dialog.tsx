/**
 * Edit Deadline Dialog
 *
 * Modal form for editing a deadline. Reuses the same field primitives
 * as the DeadlineComposer.
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
  DEADLINE_KINDS,
  DEADLINE_STATUSES,
  type DeadlineStatus,
} from "@/lib/note-constants";
import { updateDeadline } from "@/app/actions/deadlines";
import {
  updateDeadlineInitialState,
  type UpdateDeadlineFormState,
} from "@/lib/deadline-form";

export type EditableDeadline = {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  sourceRef: string | null;
  dueDate: Date;
  status: DeadlineStatus;
};

const KIND_LABEL: Record<string, string> = {
  critical: "Critical",
  auto_rule: "Auto-rule",
  manual: "Manual",
};

const STATUS_LABEL: Record<DeadlineStatus, string> = {
  open: "Open",
  completed: "Completed",
  waived: "Waived",
};

const toDateInput = (d: Date | null): string => {
  if (!d) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

export function EditDeadlineDialog({
  open,
  onOpenChange,
  deadline,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deadline: EditableDeadline;
}) {
  const action = updateDeadline.bind(null, deadline.id);
  const [state, formAction, isPending] = useActionState<
    UpdateDeadlineFormState,
    FormData
  >(action, updateDeadlineInitialState);

  const [title, setTitle] = useState(deadline.title);
  const [dueDate, setDueDate] = useState(toDateInput(deadline.dueDate));
  const [kind, setKind] = useState(deadline.kind);
  const [sourceRef, setSourceRef] = useState(deadline.sourceRef ?? "");
  const [description, setDescription] = useState(deadline.description ?? "");
  const [status, setStatus] = useState<DeadlineStatus>(deadline.status);

  useEffect(() => {
    if (open) {
      setTitle(deadline.title);
      setDueDate(toDateInput(deadline.dueDate));
      setKind(deadline.kind);
      setSourceRef(deadline.sourceRef ?? "");
      setDescription(deadline.description ?? "");
      setStatus(deadline.status);
    }
  }, [open, deadline]);

  // Close on success. Deps must be the state OBJECT, not
  // state.status: useActionState keeps its state across
  // submissions, so after the first success the status string is
  // "ok" forever. DeadlineRowMenu keeps this dialog mounted, so a
  // second save of the same deadline returns a fresh object whose
  // status compares equal — keyed on the string, the effect skips
  // and the dialog silently stays open even though the save landed.
  // Each action invocation returns a new object, so identity is
  // the reliable "a submission just finished" signal.
  useEffect(() => {
    if (state.status === "ok") onOpenChange(false);
  }, [state, onOpenChange]);

  const errs = state.errors ?? {};

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit deadline</DialogTitle>
          <DialogDescription>
            Update the title, due date, kind, source, or status.
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
              onChange={setKind}
              options={DEADLINE_KINDS.map((k) => ({
                value: k,
                label: KIND_LABEL[k] ?? k,
              }))}
            />
          </div>

          <TextField
            name="sourceRef"
            value={sourceRef}
            onChange={setSourceRef}
            placeholder='Source reference (e.g. "CRS §24-10-109")'
            error={errs.sourceRef?.[0]}
          />

          <SelectField
            name="status"
            value={status}
            onChange={(v) => setStatus(v as DeadlineStatus)}
            options={DEADLINE_STATUSES.map((s) => ({
              value: s,
              label: STATUS_LABEL[s],
            }))}
          />

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
              {isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
