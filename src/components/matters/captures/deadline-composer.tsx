/**
 * Deadline Composer — primary-deadline form at the top of the
 * Deadlines tab.
 */

"use client";

import { useState } from "react";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
import { createDeadlineWithCaptures } from "@/app/actions/captures";
import {
  captureInitialState,
  type CaptureFormState,
} from "@/lib/capture-schemas";
import {
  DEADLINE_KINDS,
  type CaptureKind,
  type NoteCapture,
} from "@/lib/note-constants";
import { DEADLINE_KIND_LABEL } from "@/lib/constants/deadline-status";
import { CaptureComposerShell } from "./capture-composer-shell";
import {
  DateField,
  SelectField,
  TextField,
  TextareaField,
} from "./primary-fields";

const SIBLING_KINDS: CaptureKind[] = ["task", "event", "time", "note_sibling"];

export function DeadlineComposer({
  matterId,
  siblingKinds,
  canPin,
}: {
  matterId: string;
  /** Sibling kinds the viewer may add (page-resolved from their
   *  create permissions); omitted = all. */
  siblingKinds?: CaptureKind[];
  /** Whether the viewer may pin a sibling note (`notes.pin`). */
  canPin?: boolean;
}) {
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

  // Reset + collapse on success, derived during render (see
  // TaskComposer for the rationale: identity of the action-state
  // object is the "a submission just finished" signal).
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
            ariaLabel="Deadline kind"
            options={DEADLINE_KINDS.map((k) => ({
              value: k,
              label: DEADLINE_KIND_LABEL[k],
            }))}
          />
          <TextField
            name="sourceRef"
            value={sourceRef}
            onChange={setSourceRef}
            placeholder="Source ref (CRS §…, FRCP …)"
            error={errs.sourceRef?.[0]}
            maxLength={200}
          />
        </div>

        <TextareaField
          name="description"
          value={description}
          onChange={setDescription}
          placeholder="Why this deadline applies (optional)"
          rows={2}
          error={errs.description?.[0]}
          maxLength={4000}
        />
      </div>
    </CaptureComposerShell>
  );
}
