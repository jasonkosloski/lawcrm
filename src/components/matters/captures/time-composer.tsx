/**
 * Time Composer — primary-time-entry form at the top of the Time tab.
 */

"use client";

import { useActionState, useEffect, useState } from "react";
import { createTimeEntryWithCaptures } from "@/app/actions/captures";
import {
  captureInitialState,
  type CaptureFormState,
} from "@/lib/capture-schemas";
import {
  todayDateString,
  type NoteCapture,
} from "@/lib/note-constants";
import { CaptureComposerShell } from "./capture-composer-shell";
import {
  DateField,
  TextField,
  TextareaField,
} from "./primary-fields";

export function TimeComposer({ matterId }: { matterId: string }) {
  const action = createTimeEntryWithCaptures.bind(null, matterId);
  const [state, formAction, isPending] = useActionState<
    CaptureFormState,
    FormData
  >(action, captureInitialState);

  const [expanded, setExpanded] = useState(false);
  const [captures, setCaptures] = useState<NoteCapture[]>([]);
  const [date, setDate] = useState(todayDateString());
  const [hours, setHours] = useState("");
  const [activity, setActivity] = useState("");
  const [narrative, setNarrative] = useState("");
  const [billable, setBillable] = useState(true);
  const [noCharge, setNoCharge] = useState(false);
  const [privileged, setPrivileged] = useState(false);

  const reset = () => {
    setDate(todayDateString());
    setHours("");
    setActivity("");
    setNarrative("");
    setBillable(true);
    setNoCharge(false);
    setPrivileged(false);
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
      collapsedLabel="Log time"
      primaryLabel="time entry"
      expanded={expanded}
      onExpand={() => setExpanded(true)}
      onCancel={() => {
        reset();
        setExpanded(false);
      }}
      formAction={formAction}
      isPending={isPending}
      hasContent={
        hours.trim().length > 0 && activity.trim().length > 0
      }
      captures={captures}
      onCapturesChange={setCaptures}
      attachmentErrors={state.attachmentErrors}
      allowedKinds={["task", "event", "deadline", "note_sibling"]}
    >
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-[auto_auto_1fr] gap-2 items-start">
          <DateField
            name="date"
            value={date}
            onChange={setDate}
            error={errs.date?.[0]}
          />
          <TextField
            name="hours"
            value={hours}
            onChange={setHours}
            placeholder="Hrs"
            error={errs.hours?.[0]}
            className="w-20 font-mono"
            autoFocus
          />
          <TextField
            name="activity"
            value={activity}
            onChange={setActivity}
            placeholder="Activity (e.g. 'Motion to compel · draft & file')"
            error={errs.activity?.[0]}
          />
        </div>

        <TextareaField
          name="narrative"
          value={narrative}
          onChange={setNarrative}
          placeholder="Narrative (optional, client-facing)"
          rows={2}
          error={errs.narrative?.[0]}
        />

        <div className="flex items-center gap-3 text-2xs text-ink-2">
          <label className="flex items-center gap-1 cursor-pointer select-none">
            <input
              type="checkbox"
              name="billable"
              checked={billable}
              onChange={(e) => setBillable(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-line"
            />
            Billable
          </label>
          <label className="flex items-center gap-1 cursor-pointer select-none">
            <input
              type="checkbox"
              name="noCharge"
              checked={noCharge}
              onChange={(e) => setNoCharge(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-line"
            />
            No charge
          </label>
          <label className="flex items-center gap-1 cursor-pointer select-none">
            <input
              type="checkbox"
              name="privileged"
              checked={privileged}
              onChange={(e) => setPrivileged(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-line"
            />
            Privileged
          </label>
        </div>
      </div>
    </CaptureComposerShell>
  );
}
