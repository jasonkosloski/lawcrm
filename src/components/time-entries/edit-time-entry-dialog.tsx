/**
 * Edit Time Entry Dialog
 *
 * Modal form mirroring the TimeComposer fields plus a status picker.
 * Once an entry is on a sent invoice (`status: billed`), the server
 * action rejects edits — surface that as a form-level error.
 *
 * The date field is a date-only value (ADR-012): the entry's stored
 * UTC-midnight Date is turned back into `YYYY-MM-DD` with
 * `dateOnlyKey` (UTC getters), never browser-local getters — those
 * read the previous day west of UTC and every save would then post
 * that day back, walking the entry one day earlier per edit.
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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { DateField, TextField, TextareaField } from "@/components/matters/captures/primary-fields";
import { DurationFields, UtbmsCodeSelect } from "@/components/time-entries/time-entry-fields";
import {
  TIME_ENTRY_STATUSES,
  TIME_ENTRY_STATUS_LABEL as STATUS_LABEL,
  type TimeEntryStatus,
} from "@/lib/constants/time-entry-status";
import { updateTimeEntry } from "@/app/actions/time-entries";
import { timeEntryInitialState, type TimeEntryFormState } from "@/lib/time-entry-constants";
import { dateOnlyKey } from "@/lib/format-date";

export type EditableTimeEntry = {
  id: string;
  /** Date-only value (UTC midnight) — read with `dateOnlyKey`. */
  date: Date;
  hours: number;
  activity: string;
  narrative: string | null;
  utbmsCode: string | null;
  billable: boolean;
  noCharge: boolean;
  privileged: boolean;
  status: TimeEntryStatus;
};

export function EditTimeEntryDialog({
  open,
  onOpenChange,
  entry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: EditableTimeEntry;
}) {
  // Wrapped useActionState: masks state left over from a previous
  // open, so a cancelled attempt's field errors ("Hours required",
  // "Entry is already billed") don't reappear when the row menu
  // reopens this still-mounted dialog. See
  // src/hooks/use-dialog-action-state.ts.
  const [state, formAction, isPending] = useDialogActionState<TimeEntryFormState, FormData>(
    updateTimeEntry.bind(null, entry.id),
    timeEntryInitialState,
    open,
  );

  const [date, setDate] = useState(dateOnlyKey(entry.date));
  const [hours, setHours] = useState(entry.hours.toString());
  const [activity, setActivity] = useState(entry.activity);
  const [narrative, setNarrative] = useState(entry.narrative ?? "");
  const [utbmsCode, setUtbmsCode] = useState(entry.utbmsCode ?? "");
  const [billable, setBillable] = useState(entry.billable);
  const [noCharge, setNoCharge] = useState(entry.noCharge);
  const [privileged, setPrivileged] = useState(entry.privileged);
  const [status, setStatus] = useState<TimeEntryStatus>(entry.status);

  // Seed the working copy from the entry every time the dialog
  // OPENS (the row menu keeps it mounted). Done during render on the
  // open flip - the stored-previous-prop pattern - not in an effect.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setDate(dateOnlyKey(entry.date));
      setHours(entry.hours.toString());
      setActivity(entry.activity);
      setNarrative(entry.narrative ?? "");
      setUtbmsCode(entry.utbmsCode ?? "");
      setBillable(entry.billable);
      setNoCharge(entry.noCharge);
      setPrivileged(entry.privileged);
      setStatus(entry.status);
    }
  }

  // Close on success. Deps must be the state OBJECT, not
  // state.status: the status string stays "ok" across saves, so a
  // second save of the same entry would never re-fire. Each action
  // invocation returns a fresh object, and the hook above only
  // changes the exposed identity when a submission lands.
  useEffect(() => {
    if (state.status === "ok") onOpenChange(false);
  }, [state, onOpenChange]);

  const errs = state.errors ?? {};

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit time entry</DialogTitle>
          <DialogDescription>
            Update the date, hours, activity, billing flags, or status.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-3">
          <div className="grid grid-cols-[auto_1fr] gap-2 items-start">
            <DateField
              name="date"
              value={date}
              onChange={setDate}
              placeholder="Date"
              error={errs.date?.[0]}
            />
            <DurationFields hours={hours} onHoursChange={setHours} error={errs.hours?.[0]} />
          </div>

          <TextField
            name="activity"
            value={activity}
            onChange={setActivity}
            placeholder="Activity (e.g. 'Motion to compel · draft')"
            error={errs.activity?.[0]}
          />

          <TextareaField
            name="narrative"
            value={narrative}
            onChange={setNarrative}
            placeholder="Detailed narrative for the client (optional)"
            rows={3}
            error={errs.narrative?.[0]}
          />

          <UtbmsCodeSelect value={utbmsCode} onChange={setUtbmsCode} error={errs.utbmsCode?.[0]} />

          <div className="flex flex-col gap-0.5">
            <NativeSelect
              name="status"
              value={status}
              onChange={(e) => setStatus(e.target.value as TimeEntryStatus)}
              aria-label="Status"
              className="w-full"
              aria-invalid={!!errs.status || undefined}
            >
              {/* "Billed" is set only by invoice generation; the
                  server refuses it here, so don't offer it. */}
              {TIME_ENTRY_STATUSES.filter((s) => s !== "billed").map((s) => (
                <NativeSelectOption key={s} value={s}>
                  {STATUS_LABEL[s]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {errs.status && <div className="text-2xs text-warn">{errs.status[0]}</div>}
          </div>

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
              No-charge
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
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
