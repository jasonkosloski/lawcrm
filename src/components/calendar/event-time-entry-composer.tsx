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

import { useEffect, useState } from "react";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { createTimeEntry } from "@/app/actions/time-entries";
import {
  timeEntryInitialState,
  type TimeEntryFormState,
} from "@/lib/time-entry-constants";
import { todayDateString } from "@/lib/note-constants";

export function EventTimeEntryComposer({
  matterId,
  eventId,
}: {
  matterId: string;
  eventId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const action = createTimeEntry.bind(null, matterId);
  // Wrapped useActionState: masks state left over from a previous
  // expand, so a failed attempt's errors don't reappear when the
  // composer is re-expanded. See src/hooks/use-dialog-action-state.ts.
  const [state, formAction, isPending] = useDialogActionState<
    TimeEntryFormState,
    FormData
  >(action, timeEntryInitialState, expanded);

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
  };

  // Reset + collapse on success. Deps key on the state OBJECT, not
  // state.status — identity is the reliable "a submission just
  // finished" signal (see TimeComposer for the full rationale).
  useEffect(() => {
    if (state.status !== "ok") return;
    reset();
    setExpanded(false);
  }, [state]);

  const errs = state.errors ?? {};
  const hasContent = hours.trim().length > 0 && activity.trim().length > 0;

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className={cn(
          "flex items-center gap-2 h-8 px-3 text-2xs text-ink-4 w-full",
          "rounded-md border border-dashed border-line bg-white",
          "hover:border-brand-300 hover:text-brand-700 transition-colors text-left"
        )}
      >
        <Plus size={12} />
        Log time for this event…
      </button>
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
            className={cn(
              "h-7 px-2 rounded-md border bg-white text-xs text-ink",
              "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
              errs.date ? "border-warn" : "border-line"
            )}
          />
          {errs.date && (
            <div className="text-2xs text-warn">{errs.date[0]}</div>
          )}
        </div>
        <div className="flex flex-col gap-0.5">
          <input
            name="hours"
            type="text"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="Hrs"
            inputMode="decimal"
            className={cn(
              "h-7 px-2 rounded-md border bg-white text-xs text-ink w-20 font-mono",
              "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
              "placeholder:text-ink-4",
              errs.hours ? "border-warn" : "border-line"
            )}
          />
          {errs.hours && (
            <div className="text-2xs text-warn">{errs.hours[0]}</div>
          )}
        </div>
        <div className="flex flex-col gap-0.5 min-w-0">
          <input
            name="activity"
            type="text"
            value={activity}
            onChange={(e) => setActivity(e.target.value)}
            placeholder="Activity (e.g. 'Hearing attendance')"
            className={cn(
              "h-7 px-2 rounded-md border bg-white text-xs text-ink w-full",
              "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
              "placeholder:text-ink-4",
              errs.activity ? "border-warn" : "border-line"
            )}
          />
          {errs.activity && (
            <div className="text-2xs text-warn">{errs.activity[0]}</div>
          )}
        </div>
      </div>

      <textarea
        name="narrative"
        value={narrative}
        onChange={(e) => setNarrative(e.target.value)}
        placeholder="Narrative (optional, client-facing)"
        rows={2}
        className={cn(
          "px-2 py-1.5 rounded-md border bg-white text-xs text-ink leading-relaxed",
          "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
          "placeholder:text-ink-4 resize-y font-sans",
          errs.narrative ? "border-warn" : "border-line"
        )}
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
          <button
            type="submit"
            disabled={isPending || !hasContent}
            className={cn(
              "inline-flex items-center h-7 px-3 rounded-md text-xs font-medium bg-brand-500 text-white",
              "hover:bg-brand-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            )}
          >
            {isPending ? "Saving…" : "Log time"}
          </button>
        </div>
      </div>
    </form>
  );
}
