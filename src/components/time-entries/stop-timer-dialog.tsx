/**
 * Stop Timer dialog — the composer the floating timer widget opens
 * on Stop.
 *
 * Prefilled from the running TimerSession: elapsed hours (already
 * rounded UP to the billing increment by the widget — the
 * timer-elapsed duration mode), activity, and matter when the
 * session has one. The matter is REQUIRED here even though the
 * session's is nullable — a TimeEntry can't exist without one, so
 * Save stays disabled until a matter is picked and the server
 * (`stopTimer`) enforces it again.
 *
 * On success the server deletes the TimerSession in the same
 * transaction that writes the entry (source: "timer"); this dialog
 * just closes and tells the widget via onStopped.
 */

"use client";

import { useEffect, useState } from "react";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DateField,
  TextField,
  TextareaField,
} from "@/components/matters/captures/primary-fields";
import {
  DurationFields,
  UtbmsCodeSelect,
} from "@/components/time-entries/time-entry-fields";
import { todayDateString } from "@/lib/note-constants";
import { stopTimer } from "@/app/actions/timer";
import { timeEntryInitialState } from "@/lib/time-entry-constants";
import type { TimerMatterOption } from "@/lib/queries/timer";
import { cn } from "@/lib/utils";

export function StopTimerDialog({
  open,
  onOpenChange,
  onStopped,
  matterOptions,
  initialMatterId,
  initialActivity,
  initialHours,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired after a successful stop so the widget can drop its
   *  optimistic session immediately (revalidation follows). */
  onStopped: () => void;
  matterOptions: TimerMatterOption[];
  initialMatterId: string | null;
  initialActivity: string | null;
  /** Elapsed hours rounded UP to the billing increment — the
   *  "timer-elapsed" duration mode prefill. Editable like any
   *  hours value. */
  initialHours: number;
}) {
  // Wrapped useActionState: masks state left over from a previous
  // open, so a failed attempt's errors don't reappear when the
  // dialog is reopened. See src/hooks/use-dialog-action-state.ts.
  const [state, formAction, isPending] = useDialogActionState(
    stopTimer,
    timeEntryInitialState,
    open
  );

  const [matterId, setMatterId] = useState(initialMatterId ?? "");
  const [date, setDate] = useState(todayDateString());
  const [hours, setHours] = useState(String(initialHours));
  const [activity, setActivity] = useState(initialActivity ?? "");
  const [narrative, setNarrative] = useState("");
  const [utbmsCode, setUtbmsCode] = useState("");
  const [billable, setBillable] = useState(true);
  const [noCharge, setNoCharge] = useState(false);
  const [privileged, setPrivileged] = useState(false);

  // Re-prefill on every open — elapsed keeps growing between opens,
  // so the hours snapshot from mount time would go stale.
  useEffect(() => {
    if (!open) return;
    setMatterId(initialMatterId ?? "");
    setDate(todayDateString());
    setHours(String(initialHours));
    setActivity(initialActivity ?? "");
    setNarrative("");
    setUtbmsCode("");
    setBillable(true);
    setNoCharge(false);
    setPrivileged(false);
  }, [open, initialMatterId, initialActivity, initialHours]);

  // Close on success — keyed on the state OBJECT, not state.status
  // (useActionState keeps state across submissions; see the identical
  // comment in LogTimeOnEntityDialog).
  useEffect(() => {
    if (state.status === "ok") {
      onStopped();
      onOpenChange(false);
    }
  }, [state, onStopped, onOpenChange]);

  const errs = state.errors ?? {};

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Stop timer &amp; log time</DialogTitle>
          <DialogDescription>
            Review the captured time — elapsed is rounded up to the
            billing increment.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <select
              name="matterId"
              value={matterId}
              onChange={(e) => setMatterId(e.target.value)}
              aria-label="Matter"
              className={cn(
                "h-8 px-2 rounded-md border bg-white text-xs",
                matterId ? "text-ink" : "text-ink-4",
                "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
                errs.matterId ? "border-warn" : "border-line"
              )}
            >
              <option value="">Select matter (required)</option>
              {matterOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            {errs.matterId && (
              <div className="text-2xs text-warn">{errs.matterId[0]}</div>
            )}
          </div>

          <div className="grid grid-cols-[auto_1fr] gap-2 items-start">
            <DateField
              name="date"
              value={date}
              onChange={setDate}
              placeholder="Date"
              error={errs.date?.[0]}
            />
            <DurationFields
              hours={hours}
              onHoursChange={setHours}
              error={errs.hours?.[0]}
            />
          </div>

          <TextField
            name="activity"
            value={activity}
            onChange={setActivity}
            placeholder="Activity"
            error={errs.activity?.[0]}
            autoFocus
          />

          <TextareaField
            name="narrative"
            value={narrative}
            onChange={setNarrative}
            placeholder="Narrative (optional, client-facing)"
            rows={3}
            error={errs.narrative?.[0]}
          />

          <UtbmsCodeSelect
            value={utbmsCode}
            onChange={setUtbmsCode}
            error={errs.utbmsCode?.[0]}
          />

          <div className="flex flex-wrap items-center gap-4 text-xs">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                name="billable"
                value="on"
                checked={billable}
                onCheckedChange={setBillable}
              />
              Billable
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                name="noCharge"
                value="on"
                checked={noCharge}
                onCheckedChange={setNoCharge}
              />
              No charge
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                name="privileged"
                value="on"
                checked={privileged}
                onCheckedChange={setPrivileged}
              />
              Privileged
            </label>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Keep running
            </Button>
            <Button
              type="submit"
              disabled={
                isPending || !matterId || !hours.trim() || !activity.trim()
              }
            >
              {isPending ? "Logging…" : "Log time"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
