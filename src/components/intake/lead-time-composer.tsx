/**
 * Lead Time Composer — "Log time" form at the top of the lead's
 * Time & expenses tab (/intake/[id]/time).
 *
 * The intake mirror of the matter Time tab's TimeComposer, minus the
 * capture stack (attached tasks/events/deadlines are matter
 * machinery — a lead has none of those surfaces). Reuses the shared
 * time-entry v2 field primitives (DurationFields with hours /
 * start–end modes, UtbmsCodeSelect) and posts through
 * `createLeadTimeEntry`, which writes a lead-scoped TimeEntry
 * (leadId set, matterId null).
 *
 * Billable defaults OFF — most intake work is non-billable firm
 * overhead; the flag marks the entry to carry forward as billable
 * work when the lead converts and the entries re-home onto the new
 * matter.
 */

"use client";

import { useCallback, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
import { createLeadTimeEntry } from "@/app/actions/time-entries";
import {
  timeEntryInitialState,
  type TimeEntryFormState,
} from "@/lib/time-entry-constants";
import { todayKey } from "@/lib/format-date";
import { useUserTimeZone } from "@/components/user-time-zone";
import {
  DateField,
  TextField,
  TextareaField,
} from "@/components/matters/captures/primary-fields";
import {
  DurationFields,
  UtbmsCodeSelect,
} from "@/components/time-entries/time-entry-fields";
import { Button } from "@/components/ui/button";

export function LeadTimeComposer({ leadId }: { leadId: string }) {
  // "Today" is the viewer's calendar day in their PROFILE zone (the
  // date input is a date-only value — ADR-012), not the browser's.
  const tz = useUserTimeZone();
  const [expanded, setExpanded] = useState(false);

  const [date, setDate] = useState(() => todayKey(tz));
  const [hours, setHours] = useState("");
  const [activity, setActivity] = useState("");
  const [narrative, setNarrative] = useState("");
  const [utbmsCode, setUtbmsCode] = useState("");
  const [billable, setBillable] = useState(false);
  const [noCharge, setNoCharge] = useState(false);
  const [privileged, setPrivileged] = useState(false);

  const reset = useCallback(() => {
    setDate(todayKey(tz));
    setHours("");
    setActivity("");
    setNarrative("");
    setUtbmsCode("");
    setBillable(false);
    setNoCharge(false);
    setPrivileged(false);
  }, [tz]);

  // Reset + collapse on success happens here, in the action's own
  // continuation, rather than in an effect watching the result: each
  // submission settles exactly once, so there is no stale-"ok" trap and
  // no setState-in-effect cascade.
  const action = useCallback(
    async (prev: TimeEntryFormState, formData: FormData) => {
      const res = await createLeadTimeEntry(leadId, prev, formData);
      if (res.status === "ok") {
        reset();
        setExpanded(false);
      }
      return res;
    },
    [leadId, reset]
  );
  // Wrapped useActionState: masks a previous attempt's errors when
  // the composer is re-expanded (same hook the matter composers use).
  const [state, formAction, isPending] = useDialogActionState<
    TimeEntryFormState,
    FormData
  >(action, timeEntryInitialState, expanded);

  // Manual dispatch: <form action> would reset every field after a
  // validation error, wiping what the user typed. Success resets
  // explicitly above.
  const [, startSubmit] = useTransition();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startSubmit(() => formAction(fd));
  };

  const errs = state.errors ?? {};
  const hasContent = hours.trim().length > 0 && activity.trim().length > 0;

  return (
    <Card className={cn(expanded && "border-brand-200")}>
      <CardContent className="p-3">
        {!expanded ? (
          <Button
            variant="outline"
            type="button"
            onClick={() => {
              // Re-seed the date: the page may have sat open past midnight.
              setDate(todayKey(tz));
              setExpanded(true);
            }}
            className="flex gap-2 text-xs text-ink-4 w-full border-dashed text-left"
          >
            <Plus size={14} />
            Log intake time
          </Button>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-2">
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
                placeholder="Activity (e.g. 'Intake call · incident walkthrough')"
                error={errs.activity?.[0]}
              />
            </div>

            <TextareaField
              name="narrative"
              value={narrative}
              onChange={setNarrative}
              placeholder="Narrative (optional — carries to the matter on conversion)"
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

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  reset();
                  setExpanded(false);
                }}
                className="text-xs text-ink-3 hover:text-ink-2 px-2"
              >
                Cancel
              </button>
              <Button
                size="xs"
                type="submit"
                disabled={isPending || !hasContent}
              >
                {isPending ? "Saving…" : "Save time entry"}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
