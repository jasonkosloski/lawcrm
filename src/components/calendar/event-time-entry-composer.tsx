/**
 * Event Time Entry Composer — compact "log time for this event" form.
 *
 * Collapsed to a single-line "Log time for this event…" button; on
 * click expands into a lightweight form with date + hours + activity
 * + narrative and the billable/no-charge/privileged flags (same
 * shape the Time tab's full composer uses, minus the sibling-capture
 * row). Submit posts to createTimeEntry with calendarEventId set so
 * the server links the entry directly to the event.
 */

"use client";

import { useState } from "react";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { createTimeEntry } from "@/app/actions/time-entries";
import { timeEntryInitialState, type TimeEntryFormState } from "@/lib/time-entry-constants";
import { todayKey } from "@/lib/format-date";
import { useUserTimeZone } from "@/components/user-time-zone";
import { useEventAttachmentsViewer } from "./event-attachments-context";
import { inputClass, textareaClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export function EventTimeEntryComposer({
  matterId,
  eventId,
}: {
  matterId: string;
  eventId: string;
}) {
  const [expanded, setExpanded] = useState(false);

  // The entry defaults to the EVENT's date (supplied by the surface
  // that knows the event), falling back to the viewer's today in
  // their profile zone — not the browser's.
  const tz = useUserTimeZone();
  const { defaultTimeEntryDate } = useEventAttachmentsViewer();
  const initialDate = defaultTimeEntryDate ?? todayKey(tz);

  const [date, setDate] = useState(initialDate);
  const [hours, setHours] = useState("");
  const [activity, setActivity] = useState("");
  const [narrative, setNarrative] = useState("");
  const [billable, setBillable] = useState(true);
  const [noCharge, setNoCharge] = useState(false);
  const [privileged, setPrivileged] = useState(false);

  const reset = () => {
    setDate(initialDate);
    setHours("");
    setActivity("");
    setNarrative("");
    setBillable(true);
    setNoCharge(false);
    setPrivileged(false);
  };

  // Reset + collapse when the save lands, from inside the action
  // itself (an event-driven path) instead of an effect watching the
  // returned state.
  const action = async (prev: TimeEntryFormState, formData: FormData) => {
    const result = await createTimeEntry(matterId, prev, formData);
    if (result.status === "ok") {
      reset();
      setExpanded(false);
    }
    return result;
  };
  // Wrapped useActionState: masks state left over from a previous
  // expand, so a failed attempt's errors don't reappear when the
  // composer is re-expanded. See src/hooks/use-dialog-action-state.ts.
  const [state, formAction, isPending] = useDialogActionState<TimeEntryFormState, FormData>(
    action,
    timeEntryInitialState,
    expanded,
  );

  const errs = state.errors ?? {};
  const hasContent = hours.trim().length > 0 && activity.trim().length > 0;

  if (!expanded) {
    return (
      <Button
        variant="outline"
        size="sm"
        type="button"
        onClick={() => {
          // Seed the working copy on every open: the modal can be
          // reused across events, so the date from the last open (or
          // a typed draft) must not carry over.
          reset();
          setExpanded(true);
        }}
        className="flex gap-2 text-2xs text-ink-4 w-full border-dashed text-left"
      >
        <Plus size={12} />
        Log time for this event…
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="calendarEventId" value={eventId} />

      <div className="grid grid-cols-[auto_auto_1fr] gap-2 items-start">
        <div className="flex flex-col gap-0.5">
          <input
            name="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Date"
            className={inputClass(!!errs.date, "xs")}
          />
          {errs.date && <div className="text-2xs text-warn">{errs.date[0]}</div>}
        </div>
        <div className="flex flex-col gap-0.5">
          <input
            name="hours"
            type="text"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="Hrs"
            inputMode="decimal"
            className={cn(inputClass(!!errs.hours, "xs"), "w-20 font-mono")}
          />
          {errs.hours && <div className="text-2xs text-warn">{errs.hours[0]}</div>}
        </div>
        <div className="flex flex-col gap-0.5 min-w-0">
          <input
            name="activity"
            type="text"
            value={activity}
            onChange={(e) => setActivity(e.target.value)}
            placeholder="Activity (e.g. 'Hearing attendance')"
            className={cn(inputClass(!!errs.activity, "xs"), "w-full")}
          />
          {errs.activity && <div className="text-2xs text-warn">{errs.activity[0]}</div>}
        </div>
      </div>

      <textarea
        name="narrative"
        value={narrative}
        onChange={(e) => setNarrative(e.target.value)}
        placeholder="Narrative (optional, client-facing)"
        rows={2}
        className={cn(textareaClass(!!errs.narrative), "px-2 leading-relaxed resize-y font-sans")}
      />

      <div className="flex items-center justify-between gap-2">
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

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              reset();
              setExpanded(false);
            }}
            className="text-2xs text-ink-3 hover:text-ink-2 px-2"
          >
            Cancel
          </button>
          <Button size="xs" type="submit" disabled={isPending || !hasContent}>
            {isPending ? "Saving…" : "Log time"}
          </Button>
        </div>
      </div>
    </form>
  );
}
