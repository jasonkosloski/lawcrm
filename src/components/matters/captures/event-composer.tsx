/**
 * Event Composer — primary-event form at the top of the Events tab.
 *
 * Start/end are `datetime-local` wall-clock values. The defaults are
 * computed in the user's PROFILE zone and the server reads what is
 * posted in that same zone (ADR-012), so a 9:00 AM hearing is stored
 * as 9:00 AM for the user, whatever zone the browser or server is in.
 */

"use client";

import { EventPrivateToggle } from "@/components/calendar/event-private-toggle";
import { useState } from "react";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
import { createEventWithCaptures } from "@/app/actions/captures";
import {
  captureInitialState,
  type CaptureFormState,
} from "@/lib/capture-schemas";
import {
  EVENT_TYPES,
  type CaptureKind,
  type NoteCapture,
} from "@/lib/note-constants";
import { EVENT_TYPE_LABEL } from "@/lib/constants/calendar-event-type";
import { useUserTimeZone } from "@/components/user-time-zone";
import { nextHourInput } from "@/lib/capture-defaults";
import { CaptureComposerShell } from "./capture-composer-shell";
import {
  DateTimeField,
  SelectField,
  TextField,
  TextareaField,
} from "./primary-fields";

const SIBLING_KINDS: CaptureKind[] = [
  "task",
  "deadline",
  "time",
  "note_sibling",
];

export function EventComposer({
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
  const tz = useUserTimeZone();
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
  const [startTime, setStartTime] = useState(() => nextHourInput(tz));
  const [endTime, setEndTime] = useState(() => nextHourInput(tz, 1));
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  // Per-event visibility override — same shape as the calendar's
  // NewEventComposer. Matter events are already team-visible by
  // definition; flipping this to true exposes details firm-wide.
  const [showDetails, setShowDetails] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);

  const reset = () => {
    setTitle("");
    setType("meeting");
    setStartTime(nextHourInput(tz));
    setEndTime(nextHourInput(tz, 1));
    setLocation("");
    setDescription("");
    setCaptures([]);
    setShowDetails(false);
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
            ariaLabel="Event type"
            options={EVENT_TYPES.map((t) => ({
              value: t,
              label: EVENT_TYPE_LABEL[t],
            }))}
          />
          <TextField
            name="location"
            value={location}
            onChange={setLocation}
            placeholder="Location or Zoom link (optional)"
            error={errs.location?.[0]}
            maxLength={200}
          />
        </div>

        <TextareaField
          name="description"
          value={description}
          onChange={setDescription}
          placeholder="Details (optional)"
          rows={2}
          error={errs.description?.[0]}
          maxLength={4000}
        />

        {/* Per-event visibility — matter team always sees, but a
            firm-wide event (CLE, all-hands, settlement
            announcement) may want to surface details to non-team
            firm members too. */}
        <input
          type="hidden"
          name="visibility"
          value={isPrivate ? "private" : showDetails ? "show_details" : "default"}
        />
        <label className="flex items-start gap-2 text-xs text-ink-3 select-none cursor-pointer">
          <input
            type="checkbox"
            checked={showDetails}
            onChange={(e) => {
              setShowDetails(e.target.checked);
              if (e.target.checked) setIsPrivate(false);
            }}
            className="mt-0.5 h-3.5 w-3.5 rounded border-line"
          />
          <span>
            <span className="text-ink">Show details firm-wide</span>
            <span className="block text-[10px] text-ink-4 leading-relaxed mt-0.5">
              Off: only the matter team and invited attendees see details.
            </span>
          </span>
        </label>
        <EventPrivateToggle
          checked={isPrivate}
          onChange={(next) => {
            setIsPrivate(next);
            if (next) setShowDetails(false);
          }}
        />
      </div>
    </CaptureComposerShell>
  );
}
