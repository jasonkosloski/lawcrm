/**
 * Edit Time Entry Dialog
 *
 * Modal form mirroring the TimeComposer fields plus a status picker.
 * Once an entry is on a sent invoice (`status: billed`), the server
 * action rejects edits — surface that as a form-level error.
 */

"use client";

import { useActionState, useEffect, useState } from "react";
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
  SelectField,
  TextField,
  TextareaField,
} from "@/components/matters/captures/primary-fields";
import {
  TIME_ENTRY_STATUSES,
  type TimeEntryStatus,
} from "@/lib/note-constants";
import { updateTimeEntry } from "@/app/actions/time-entries";
import {
  timeEntryInitialState,
  type TimeEntryFormState,
} from "@/lib/time-entry-constants";

export type EditableTimeEntry = {
  id: string;
  date: Date;
  hours: number;
  activity: string;
  narrative: string | null;
  billable: boolean;
  noCharge: boolean;
  privileged: boolean;
  status: TimeEntryStatus;
};

const STATUS_LABEL: Record<TimeEntryStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  billable: "Billable",
  billed: "Billed",
  written_off: "Written off",
};

const toDateInput = (d: Date): string => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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
  const action = updateTimeEntry.bind(null, entry.id);
  const [state, formAction, isPending] = useActionState<
    TimeEntryFormState,
    FormData
  >(action, timeEntryInitialState);

  const [date, setDate] = useState(toDateInput(entry.date));
  const [hours, setHours] = useState(entry.hours.toString());
  const [activity, setActivity] = useState(entry.activity);
  const [narrative, setNarrative] = useState(entry.narrative ?? "");
  const [billable, setBillable] = useState(entry.billable);
  const [noCharge, setNoCharge] = useState(entry.noCharge);
  const [privileged, setPrivileged] = useState(entry.privileged);
  const [status, setStatus] = useState<TimeEntryStatus>(entry.status);

  useEffect(() => {
    if (open) {
      setDate(toDateInput(entry.date));
      setHours(entry.hours.toString());
      setActivity(entry.activity);
      setNarrative(entry.narrative ?? "");
      setBillable(entry.billable);
      setNoCharge(entry.noCharge);
      setPrivileged(entry.privileged);
      setStatus(entry.status);
    }
  }, [open, entry]);

  useEffect(() => {
    if (state.status === "ok") onOpenChange(false);
  }, [state.status, onOpenChange]);

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
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <DateField
              name="date"
              value={date}
              onChange={setDate}
              placeholder="Date"
              error={errs.date?.[0]}
            />
            <TextField
              name="hours"
              value={hours}
              onChange={setHours}
              placeholder="Hours"
              error={errs.hours?.[0]}
              className="w-24"
            />
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

          <SelectField
            name="status"
            value={status}
            onChange={(v) => setStatus(v as TimeEntryStatus)}
            options={TIME_ENTRY_STATUSES.map((s) => ({
              value: s,
              label: STATUS_LABEL[s],
            }))}
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
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
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
