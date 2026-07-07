/**
 * Deadline Composer — primary-deadline form at the top of the
 * Deadlines tab.
 */

"use client";

import { useEffect, useState } from "react";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
import { createDeadlineWithCaptures } from "@/app/actions/captures";
import {
  captureInitialState,
  type CaptureFormState,
} from "@/lib/capture-schemas";
import {
  DEADLINE_KINDS,
  type NoteCapture,
} from "@/lib/note-constants";
import { CaptureComposerShell } from "./capture-composer-shell";
import {
  DateField,
  SelectField,
  TextField,
  TextareaField,
} from "./primary-fields";

export function DeadlineComposer({ matterId }: { matterId: string }) {
  const [expanded, setExpanded] = useState(false);
  const action = createDeadlineWithCaptures.bind(null, matterId);
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
  const [kind, setKind] =
    useState<(typeof DEADLINE_KINDS)[number]>("manual");
  const [sourceRef, setSourceRef] = useState("");
  const [description, setDescription] = useState("");

  const reset = () => {
    setTitle("");
    setDueDate("");
    setKind("manual");
    setSourceRef("");
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
      collapsedLabel="Add a deadline"
      primaryLabel="deadline"
      expanded={expanded}
      onExpand={() => setExpanded(true)}
      onCancel={() => {
        reset();
        setExpanded(false);
      }}
      formAction={formAction}
      isPending={isPending}
      hasContent={title.trim().length > 0 && dueDate.length > 0}
      captures={captures}
      onCapturesChange={setCaptures}
      attachmentErrors={state.attachmentErrors}
      allowedKinds={["task", "event", "time", "note_sibling"]}
    >
      <div className="flex flex-col gap-2">
        <TextField
          name="title"
          value={title}
          onChange={setTitle}
          placeholder="Deadline title (e.g. 'CGIA notice due')"
          error={errs.title?.[0]}
          autoFocus
        />

        <div className="grid grid-cols-[1fr_auto_1fr] gap-2">
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
              label: k.replace("_", " "),
            }))}
          />
          <TextField
            name="sourceRef"
            value={sourceRef}
            onChange={setSourceRef}
            placeholder="Source ref (CRS §…, FRCP …)"
          />
        </div>

        <TextareaField
          name="description"
          value={description}
          onChange={setDescription}
          placeholder="Why this deadline applies (optional)"
          rows={2}
          error={errs.description?.[0]}
        />
      </div>
    </CaptureComposerShell>
  );
}
