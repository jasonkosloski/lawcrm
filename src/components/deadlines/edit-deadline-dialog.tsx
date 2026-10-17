/**
 * Edit Deadline Dialog
 *
 * Modal form for editing a deadline. Reuses the same field primitives
 * as the DeadlineComposer.
 *
 * Structure: this outer component stays mounted (DeadlineRowMenu
 * renders it unconditionally) and owns the action state; the form
 * itself is a child that only exists while the dialog is open, so its
 * working copy is seeded fresh on every open and a prop refresh while
 * the dialog is open (an upload finishing, a revalidate) can never
 * wipe what the user has typed.
 *
 * Dates: `dueDateKey` is the date-only value as `YYYY-MM-DD`
 * (ADR-012) computed with `dateOnlyKey` — it is never turned into a
 * `Date` in the browser, so no browser zone can shift it a day.
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
import {
  DEADLINE_KINDS,
  DEADLINE_KIND_LABEL,
  DEADLINE_STATUSES,
  DEADLINE_STATUS_LABEL,
  type DeadlineKind,
  type DeadlineStatus,
} from "@/lib/constants/deadline-status";
import { formatDateOnly, parseDateOnly } from "@/lib/format-date";
import { SOL_SOURCE_TYPE } from "@/lib/sol";
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
  /** Due date as `YYYY-MM-DD` (`dateOnlyKey(row.dueDate)`, computed on
   *  the server). A string on purpose: a `Date` read with the browser's
   *  getters shows the previous day west of UTC. */
  dueDateKey: string;
  status: DeadlineStatus;
  /** `row.updatedAt.toISOString()` — posted back so a save made from
   *  a stale form is refused instead of reverting someone else's edit. */
  updatedAt: string;
  /** `statute_of_limitations` marks the auto-managed SOL mirror row:
   *  only its status is editable here (the matter owns the rest). */
  sourceType?: string | null;
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
  // Wrapped useActionState: masks state left over from a previous
  // open, so a failed attempt's field errors don't reappear when
  // the dialog is reopened. See src/hooks/use-dialog-action-state.ts.
  const [state, formAction, isPending] = useDialogActionState<
    UpdateDeadlineFormState,
    FormData
  >(action, updateDeadlineInitialState, open);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit deadline</DialogTitle>
          <DialogDescription>
            Update the title, due date, kind, source, or status.
          </DialogDescription>
        </DialogHeader>

        <EditDeadlineForm
          deadline={deadline}
          errors={state.errors ?? {}}
          formAction={formAction}
          isPending={isPending}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function EditDeadlineForm({
  deadline,
  errors: errs,
  formAction,
  isPending,
  onCancel,
}: {
  deadline: EditableDeadline;
  errors: NonNullable<UpdateDeadlineFormState["errors"]>;
  formAction: (formData: FormData) => void;
  isPending: boolean;
  onCancel: () => void;
}) {
  // Working copy, seeded once per open (this component only exists
  // while the dialog is open).
  const [title, setTitle] = useState(deadline.title);
  const [dueDate, setDueDate] = useState(deadline.dueDateKey);
  const [kind, setKind] = useState(deadline.kind);
  const [sourceRef, setSourceRef] = useState(deadline.sourceRef ?? "");
  const [description, setDescription] = useState(deadline.description ?? "");
  const [status, setStatus] = useState<DeadlineStatus>(deadline.status);
  // The row version this form was seeded from (see EditableDeadline).
  const [expectedUpdatedAt] = useState(deadline.updatedAt);
  const isSol = deadline.sourceType === SOL_SOURCE_TYPE;

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

      {isSol ? (
        <div className="flex flex-col gap-2 rounded-md border border-line bg-paper-2 px-3 py-2 text-sm">
          <div className="font-medium text-ink">{deadline.title}</div>
          <div className="text-ink-3">
            Due {formatDateOnly(parseDateOnly(dueDate), "medium")}. This
            deadline is the matter&apos;s statute of limitations and is managed
            on the matter edit page. Only its status can be changed here.
          </div>
          {errs.dueDate?.[0] && (
            <div role="alert" className="text-xs text-destructive">
              {errs.dueDate[0]}
            </div>
          )}
          {/* Posted only to satisfy the shared form schema; the
              server ignores everything but status for this row. */}
          <input type="hidden" name="title" value={deadline.title} />
          <input type="hidden" name="dueDate" value={dueDate} />
          <input type="hidden" name="kind" value={deadline.kind} />
        </div>
      ) : (
        <>
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
              ariaLabel="Deadline kind"
              options={DEADLINE_KINDS.map((k) => ({
                value: k,
                label: DEADLINE_KIND_LABEL[k as DeadlineKind],
              }))}
            />
          </div>

          <TextField
            name="sourceRef"
            value={sourceRef}
            onChange={setSourceRef}
            placeholder='Source reference (e.g. "CRS §24-10-109")'
            error={errs.sourceRef?.[0]}
            maxLength={200}
          />
        </>
      )}

      <SelectField
        name="status"
        value={status}
        onChange={(v) => setStatus(v as DeadlineStatus)}
        ariaLabel="Status"
        options={DEADLINE_STATUSES.map((s) => ({
          value: s,
          label: DEADLINE_STATUS_LABEL[s],
        }))}
      />

      {!isSol && (
        <TextareaField
          name="description"
          value={description}
          onChange={setDescription}
          placeholder="Why this deadline applies (optional)"
          rows={3}
          error={errs.description?.[0]}
          maxLength={4000}
        />
      )}

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
