/**
 * Event Composer — primary-event form at the top of the Events tab.
 */

"use client";

import { useEffect, useState } from "react";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
import { createEventWithCaptures } from "@/app/actions/captures";
import {
  captureInitialState,
  type CaptureFormState,
} from "@/lib/capture-schemas";
import {
  EVENT_TYPES,
  nextHourDateTimeString,
  type NoteCapture,
} from "@/lib/note-constants";
import { CaptureComposerShell } from "./capture-composer-shell";
import {
  DateTimeField,
  SelectField,
  TextField,
  TextareaField,
} from "./primary-fields";

export function EventComposer({ matterId }: { matterId: string }) {
  const [expanded, setExpanded] = useState(false);
  const action = createEventWithCaptures.bind(null, matterId);
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
  const [type, setType] =
    useState<(typeof EVENT_TYPES)[number]>("meeting");
  const [startTime, setStartTime] = useState(nextHourDateTimeString());
  const [endTime, setEndTime] = useState(nextHourDateTimeString(1));
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  // Per-event visibility override — same shape as the calendar's
  // NewEventComposer. Matter events are already team-visible by
  // definition; flipping this to true exposes details firm-wide.
  const [showDetails, setShowDetails] = useState(false);

  const reset = () => {
    setTitle("");
    setType("meeting");
    setStartTime(nextHourDateTimeString());
    setEndTime(nextHourDateTimeString(1));
    setLocation("");
    setDescription("");
    setCaptures([]);
    setShowDetails(false);
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
      collapsedLabel="Schedule an event"
      primaryLabel="event"
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
      allowedKinds={["task", "deadline", "time", "note_sibling"]}
    >
      <div className="flex flex-col gap-2">
        <TextField
          name="title"
          value={title}
          onChange={setTitle}
          placeholder="Event title (hearing, deposition, meeting…)"
          error={errs.title?.[0]}
          autoFocus
        />

        <div className="grid grid-cols-2 gap-2">
          <DateTimeField
            name="startTime"
            value={startTime}
            onChange={setStartTime}
            label="Starts"
            error={errs.startTime?.[0]}
          />
          <DateTimeField
            name="endTime"
            value={endTime}
            onChange={setEndTime}
            label="Ends"
            error={errs.endTime?.[0]}
          />
        </div>

        <div className="grid grid-cols-[auto_1fr] gap-2">
          <SelectField
            name="type"
            value={type}
            onChange={(v) => setType(v as (typeof EVENT_TYPES)[number])}
            options={EVENT_TYPES.map((t) => ({
              value: t,
              label: t.replace("_", " "),
            }))}
          />
          <TextField
            name="location"
            value={location}
            onChange={setLocation}
            placeholder="Location or Zoom link (optional)"
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

        {/* Per-event visibility — matter team always sees, but a
            firm-wide event (CLE, all-hands, settlement
            announcement) may want to surface details to non-team
            firm members too. */}
        <input
          type="hidden"
          name="visibility"
          value={showDetails ? "show_details" : "default"}
        />
        <label className="flex items-start gap-2 text-xs text-ink-3 select-none cursor-pointer">
          <input
            type="checkbox"
            checked={showDetails}
            onChange={(e) => setShowDetails(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 rounded border-line"
          />
          <span>
            <span className="text-ink">Show details firm-wide</span>
            <span className="block text-[10px] text-ink-4 leading-relaxed mt-0.5">
              Off: only the matter team and invited attendees see details.
            </span>
          </span>
        </label>
      </div>
    </CaptureComposerShell>
  );
}
