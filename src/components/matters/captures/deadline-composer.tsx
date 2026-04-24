/**
 * Deadline Composer — primary-deadline form at the top of the
 * Deadlines tab.
 */

"use client";

import { useActionState, useEffect, useState } from "react";
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
  const action = createDeadlineWithCaptures.bind(null, matterId);
  const [state, formAction, isPending] = useActionState<
    CaptureFormState,
    FormData
  >(action, captureInitialState);

  const [expanded, setExpanded] = useState(false);
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

  useEffect(() => {
    if (state.status === "ok") {
      reset();
      setExpanded(false);
    }
  }, [state.status]);

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
