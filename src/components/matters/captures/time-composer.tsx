/**
 * Time Composer — primary-time-entry form at the top of the Time tab.
 *
 * v2 fields: duration modes (decimal hours or start–end pair via
 * DurationFields), client-facing narrative, UTBMS code picker, and
 * the billable / no-charge / privileged toggles. Everything posts
 * through `createTimeEntryWithCaptures` — the range mode computes a
 * plain `hours` value client-side so the action schema is unchanged
 * in shape (utbmsCode is the only new field).
 */

"use client";

import { useEffect, useState } from "react";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
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
import {
  DurationFields,
  UtbmsCodeSelect,
} from "@/components/time-entries/time-entry-fields";

export function TimeComposer({ matterId }: { matterId: string }) {
  const [expanded, setExpanded] = useState(false);
  const action = createTimeEntryWithCaptures.bind(null, matterId);
  // Wrapped useActionState: masks state left over from a previous
  // expand, so a failed attempt's field/attachment errors don't
  // reappear when the composer is re-expanded. See
  // src/hooks/use-dialog-action-state.ts.
  const [state, formAction, isPending] = useDialogActionState<
    CaptureFormState,
    FormData
  >(action, captureInitialState, expanded);

  const [captures, setCaptures] = useState<NoteCapture[]>([]);
  const [date, setDate] = useState(todayDateString());
  const [hours, setHours] = useState("");
  const [activity, setActivity] = useState("");
  const [narrative, setNarrative] = useState("");
  const [utbmsCode, setUtbmsCode] = useState("");
  const [billable, setBillable] = useState(true);
  const [noCharge, setNoCharge] = useState(false);
  const [privileged, setPrivileged] = useState(false);

  const reset = () => {
    setDate(todayDateString());
    setHours("");
    setActivity("");
    setNarrative("");
    setUtbmsCode("");
    setBillable(true);
    setNoCharge(false);
    setPrivileged(false);
    setCaptures([]);
  };

  // Reset + collapse on success. Deps key on the state OBJECT, not
  // state.status: useActionState keeps its state across
  // submissions, so after the first success the status string is
  // "ok" forever and a second success would skip the effect,
  // leaving the form expanded with stale values. Each action
  // invocation returns a fresh object, so identity is the reliable
  // signal.
  useEffect(() => {
    if (state.status === "ok") {
      reset();
      setExpanded(false);
    }
  }, [state]);

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
          <DurationFields
            hours={hours}
            onHoursChange={setHours}
            error={errs.hours?.[0]}
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

        <div className="flex flex-wrap items-center gap-3 text-2xs text-ink-2">
          <UtbmsCodeSelect
            value={utbmsCode}
            onChange={setUtbmsCode}
            error={errs.utbmsCode?.[0]}
            className="max-w-64"
          />
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
