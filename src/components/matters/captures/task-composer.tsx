/**
 * Task Composer — primary-task form at the top of the Tasks tab.
 *
 * Same shape as the note composer: a collapsed "Add a task" bar that
 * expands into a title + due + priority + assignee form with the
 * CaptureStack below for sibling records (events, deadlines, time,
 * or a quick-capture note). Save writes the task + siblings in one
 * transaction via createTaskWithCaptures.
 *
 * `scope` picks the write: a matter task (createTaskWithCaptures) or
 * an intake task on a lead (createLeadTask, no siblings — the page
 * passes `siblingKinds={[]}`).
 *
 * Assignee defaults to the CURRENT user (the pre-picker behavior);
 * picking someone else notifies them on create (actor-exclusion —
 * see notifyTaskAssigned). "Unassigned" posts `ownerId=""`.
 */

"use client";

import { useState } from "react";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
import {
  createLeadTask,
  createTaskWithCaptures,
} from "@/app/actions/captures";
import type { RecordScope } from "@/lib/record-scope";
import {
  captureInitialState,
  type CaptureFormState,
} from "@/lib/capture-schemas";
import {
  TASK_PRIORITIES,
  type CaptureKind,
  type NoteCapture,
} from "@/lib/note-constants";
import { TASK_PRIORITY_LABEL } from "@/lib/constants/priority";
import {
  AssigneeSelect,
  type AssigneeOption,
} from "@/components/tasks/assignee-select";
import { CaptureComposerShell } from "./capture-composer-shell";
import {
  DateField,
  SelectField,
  TextField,
  TextareaField,
} from "./primary-fields";

const SIBLING_KINDS: CaptureKind[] = [
  "event",
  "deadline",
  "time",
  "note_sibling",
];

export function TaskComposer({
  scope,
  assignees,
  currentUserId,
  siblingKinds,
  canPin,
}: {
  /** The matter or intake lead the task goes on. */
  scope: RecordScope;
  /** Active firm users for the assignee picker. */
  assignees: AssigneeOption[];
  /** The viewer — the picker's default selection (self-assign). */
  currentUserId: string;
  /** Sibling kinds the viewer may add (page-resolved from their
   *  create permissions); omitted = all. */
  siblingKinds?: CaptureKind[];
  /** Whether the viewer may pin a sibling note (`notes.pin`). */
  canPin?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const action =
    scope.kind === "matter"
      ? createTaskWithCaptures.bind(null, scope.matterId)
      : createLeadTask.bind(null, scope.leadId);
  // Wrapped useActionState: masks state left over from a previous
  // expand, so a failed attempt's field/attachment errors don't
  // reappear when the composer is re-expanded. See
  // src/hooks/use-dialog-action-state.ts.
  const [state, formAction, isPending] = useDialogActionState<
    CaptureFormState,
    FormData
  >(action, captureInitialState, expanded);

  const [captures, setCaptures] = useState<NoteCapture[]>([]);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] =
    useState<(typeof TASK_PRIORITIES)[number]>("normal");
  const [ownerId, setOwnerId] = useState(currentUserId);
  const [description, setDescription] = useState("");

  const reset = () => {
    setTitle("");
    setDueDate("");
    setPriority("normal");
    setOwnerId(currentUserId);
    setDescription("");
    setCaptures([]);
  };

  // Reset + collapse on success, derived during render (React's "reset
  // state when a value changes" pattern) rather than in an effect. The
  // action state is a fresh object per submission, so object identity
  // is the reliable "a submission just finished" signal — keying on
  // `state.status` would skip the second success (status stays "ok").
  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    if (state.status === "ok") {
      reset();
      setExpanded(false);
    }
  }

  const errs = state.errors ?? {};

  return (
    <CaptureComposerShell
      collapsedLabel="Add a task"
      primaryLabel="task"
      expanded={expanded}
      onExpand={() => setExpanded(true)}
      onCancel={() => {
        reset();
        setExpanded(false);
      }}
      formAction={formAction}
      isPending={isPending}
      hasContent={title.trim().length > 0}
      captures={captures}
      onCapturesChange={setCaptures}
      attachmentErrors={state.attachmentErrors}
      allowedKinds={SIBLING_KINDS.filter(
        (k) => !siblingKinds || siblingKinds.includes(k)
      )}
      canPin={canPin}
      formError={errs._form?.[0]}
    >
      <div className="flex flex-col gap-2">
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
            onChange={(v) =>
              setPriority(v as (typeof TASK_PRIORITIES)[number])
            }
            ariaLabel="Priority"
            options={TASK_PRIORITIES.map((p) => ({
              value: p,
              label: TASK_PRIORITY_LABEL[p],
            }))}
          />
        </div>

        <AssigneeSelect
          value={ownerId}
          onChange={setOwnerId}
          assignees={assignees}
          error={errs.ownerId?.[0]}
        />

        <TextareaField
          name="description"
          value={description}
          onChange={setDescription}
          placeholder="Details (optional)"
          rows={2}
          error={errs.description?.[0]}
          maxLength={4000}
        />
      </div>
    </CaptureComposerShell>
  );
}
