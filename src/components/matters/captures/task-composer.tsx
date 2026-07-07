/**
 * Task Composer — primary-task form at the top of the Tasks tab.
 *
 * Same shape as the note composer: a collapsed "Add a task" bar that
 * expands into a title + due + priority form with the CaptureStack
 * below for sibling records (events, deadlines, time, or a
 * quick-capture note). Save writes the task + siblings in one
 * transaction via createTaskWithCaptures.
 */

"use client";

import { useEffect, useState } from "react";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
import { createTaskWithCaptures } from "@/app/actions/captures";
import {
  captureInitialState,
  type CaptureFormState,
} from "@/lib/capture-schemas";
import {
  TASK_PRIORITIES,
  type NoteCapture,
} from "@/lib/note-constants";
import { CaptureComposerShell } from "./capture-composer-shell";
import {
  DateField,
  SelectField,
  TextField,
  TextareaField,
} from "./primary-fields";

export function TaskComposer({ matterId }: { matterId: string }) {
  const [expanded, setExpanded] = useState(false);
  const action = createTaskWithCaptures.bind(null, matterId);
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
  const [description, setDescription] = useState("");

  const reset = () => {
    setTitle("");
    setDueDate("");
    setPriority("normal");
    setDescription("");
    setCaptures([]);
  };

  // Reset + collapse on success. Deps key on the state OBJECT, not
  // state.status — identity is the reliable "a submission just
  // finished" signal (see TimeComposer for the full rationale).
  useEffect(() => {
    if (state.status === "ok") {
      reset();
      setExpanded(false);
    }
  }, [state]);

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
      allowedKinds={["event", "deadline", "time", "note_sibling"]}
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
            options={TASK_PRIORITIES.map((p) => ({ value: p, label: p }))}
          />
        </div>

        <TextareaField
          name="description"
          value={description}
          onChange={setDescription}
          placeholder="Details (optional)"
          rows={2}
          error={errs.description?.[0]}
        />
      </div>
    </CaptureComposerShell>
  );
}
