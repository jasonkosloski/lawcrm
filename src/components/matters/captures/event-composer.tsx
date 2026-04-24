/**
 * Event Composer — primary-event form at the top of the Events tab.
 */

"use client";

import { useActionState, useEffect, useState } from "react";
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
  const action = createEventWithCaptures.bind(null, matterId);
  const [state, formAction, isPending] = useActionState<
    CaptureFormState,
    FormData
  >(action, captureInitialState);

  const [expanded, setExpanded] = useState(false);
  const [captures, setCaptures] = useState<NoteCapture[]>([]);
  const [title, setTitle] = useState("");
  const [type, setType] =
    useState<(typeof EVENT_TYPES)[number]>("meeting");
  const [startTime, setStartTime] = useState(nextHourDateTimeString());
  const [endTime, setEndTime] = useState(nextHourDateTimeString(1));
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");

  const reset = () => {
    setTitle("");
    setType("meeting");
    setStartTime(nextHourDateTimeString());
    setEndTime(nextHourDateTimeString(1));
    setLocation("");
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
      </div>
    </CaptureComposerShell>
  );
}
