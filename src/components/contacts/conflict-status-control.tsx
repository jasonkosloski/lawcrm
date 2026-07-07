/**
 * Conflict-flag control for the contact detail page.
 *
 * The conflict checker sets `conflictStatus` programmatically; this
 * is the manual override for contacts.edit holders — flag a contact,
 * record an override, or clear the flag. A short justification is
 * required and lands in the firm activity log, so there's always a
 * human-readable "why" next to a manual change.
 */

"use client";

import { useState, useTransition } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  SelectField,
  TextareaField,
} from "@/components/matters/captures/primary-fields";
import { setContactConflictStatus } from "@/app/actions/contacts";

const STATUS_OPTIONS = [
  { value: "clear", label: "Clear — no conflict" },
  { value: "flagged", label: "Flagged — potential conflict" },
  { value: "override", label: "Override — conflict reviewed & waived" },
];

export function ConflictStatusControl({
  contactId,
  currentStatus,
}: {
  contactId: string;
  currentStatus: string;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(currentStatus);
  const [justification, setJustification] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onOpenChange = (next: boolean) => {
    if (next) {
      setStatus(currentStatus);
      setJustification("");
      setError(null);
    }
    setOpen(next);
  };

  const save = () => {
    if (!justification.trim()) {
      setError("A short justification is required — it goes on the audit log.");
      return;
    }
    startTransition(async () => {
      const res = await setContactConflictStatus(
        contactId,
        status,
        justification
      );
      if (res.ok) setOpen(false);
      else setError(res.error ?? "Could not update the conflict status");
    });
  };

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-1.5 text-2xs"
        onClick={() => onOpenChange(true)}
      >
        <ShieldAlert />
        Update
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Update conflict status</DialogTitle>
            <DialogDescription>
              Manual changes require a justification, which is recorded
              on the firm activity log.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <SelectField
              name="conflictStatus"
              value={status}
              onChange={setStatus}
              options={STATUS_OPTIONS}
            />
            <TextareaField
              name="justification"
              value={justification}
              onChange={setJustification}
              placeholder="Why? e.g. “Adverse party on Smith v. Jones (2023), waiver signed 3/12.”"
              rows={3}
            />
            {error && (
              <div className="text-xs text-warn px-3 py-2 rounded-md bg-warn-soft border border-warn-border">
                {error}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save status"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
