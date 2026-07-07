/**
 * Log Time on Task / Deadline dialog.
 *
 * Same fields as the time composers elsewhere — date, hours,
 * activity, narrative, billing flags. The action prop binds the
 * parent (taskId or deadlineId) so the same dialog handles both
 * cases. Auto-closes on successful save.
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
import { todayDateString } from "@/lib/note-constants";
import {
  noteAttachmentInitialState,
  type NoteAttachmentFormState,
} from "@/lib/note-attachment-form";

export function LogTimeOnEntityDialog({
  open,
  onOpenChange,
  action,
  parentLabel,
  parentKind,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-bound server action — `addTimeEntryToTask.bind(null, id)` or
   *  `addTimeEntryToDeadline.bind(null, id)` from the call site. */
  action: (
    prev: NoteAttachmentFormState,
    formData: FormData
  ) => Promise<NoteAttachmentFormState>;
  /** What the time is being logged against, shown in the dialog
   *  description so context is obvious. */
  parentLabel: string;
  parentKind: "task" | "deadline" | "email" | "message" | "call" | "voicemail";
}) {
  // Wrapped useActionState: masks state left over from a previous
  // open, so a failed attempt's errors don't reappear when the
  // dialog is reopened. See src/hooks/use-dialog-action-state.ts.
  const [state, formAction, isPending] = useDialogActionState<
    NoteAttachmentFormState,
    FormData
  >(action, noteAttachmentInitialState, open);

  const [date, setDate] = useState(todayDateString());
  const [hours, setHours] = useState("");
  const [activity, setActivity] = useState("");
  const [narrative, setNarrative] = useState("");
  const [billable, setBillable] = useState(true);
  const [noCharge, setNoCharge] = useState(false);
  const [privileged, setPrivileged] = useState(false);

  // Reset on open so each invocation starts fresh.
  useEffect(() => {
    if (!open) return;
    setDate(todayDateString());
    setHours("");
    setActivity("");
    setNarrative("");
    setBillable(true);
    setNoCharge(false);
    setPrivileged(false);
  }, [open]);

  // Auto-close on successful save. Deps must be the state OBJECT, not
  // `state.status`: useActionState keeps its state across submissions,
  // and this component stays mounted between opens (dashboard/task rows
  // keep it rendered), so after the first success the status string is
  // "ok" forever — keyed on the string, a second log's fresh state
  // object compares equal and the effect never re-fires, leaving the
  // dialog silently open with a cleared form and inviting a duplicate
  // entry. Object identity is the reliable "a submission just finished"
  // signal (same fix as EditTaskDialog / RecordPaymentDialog).
  useEffect(() => {
    if (state.status === "ok") onOpenChange(false);
  }, [state, onOpenChange]);

  const errs = state.errors ?? {};

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Log time on {parentKind}
          </DialogTitle>
          <DialogDescription className="truncate">
            {parentLabel}
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
              placeholder="Hrs"
              error={errs.hours?.[0]}
              className="w-24"
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
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending || !hours.trim() || !activity.trim()}
            >
              {isPending ? "Logging…" : "Log time"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
