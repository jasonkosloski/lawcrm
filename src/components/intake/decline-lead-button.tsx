/**
 * Decline Lead Button + Dialog
 *
 * Replaces the disabled "Decline" placeholder in the lead detail
 * topbar. Captures an optional reason and marks the lead's stage
 * "declined". The lead leaves the active queue and the topbar pivots
 * to the resolved state.
 */

"use client";

import { useCallback, useState, useTransition } from "react";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
import { Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { TextareaField } from "@/components/matters/captures/primary-fields";
import { declineLead } from "@/app/actions/leads";
import { declineLeadInitialState, type DeclineLeadFormState } from "@/lib/lead-conversion-form";

export function DeclineLeadButton({ leadId }: { leadId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  // Close on success, in the action's own continuation (each
  // submission settles exactly once — no stale-"ok" trap, no
  // setState-in-effect). Server revalidation then re-renders the
  // layout with the resolved-lead topbar variant.
  const action = useCallback(
    async (prev: DeclineLeadFormState, formData: FormData) => {
      const res = await declineLead(leadId, prev, formData);
      if (res.status === "ok") setOpen(false);
      return res;
    },
    [leadId],
  );
  // Wrapped useActionState: masks state left over from a previous
  // open, so a failed attempt's error banner doesn't reappear when
  // the dialog is reopened. See src/hooks/use-dialog-action-state.ts.
  const [state, formAction, isPending] = useDialogActionState<DeclineLeadFormState, FormData>(
    action,
    declineLeadInitialState,
    open,
  );

  // A fresh dialog each time: clear the reason in the open handler.
  const handleOpenChange = (next: boolean) => {
    if (next) setReason("");
    setOpen(next);
  };

  // Manual dispatch so a server error doesn't wipe the typed reason.
  const [, startSubmit] = useTransition();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startSubmit(() => formAction(fd));
  };

  const errs = state.errors ?? {};
  const formError = errs._form?.[0];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            <Ban />
            Decline
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Decline lead</DialogTitle>
          <DialogDescription>
            Mark this lead as declined and remove it from the active intake queue. The reason is
            internal — it stays on the lead for future reference but isn&apos;t shared with the
            prospective client.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <TextareaField
            name="reason"
            value={reason}
            onChange={setReason}
            placeholder="Why declining? (optional — e.g. 'Conflict — opposing party already a current client')"
            rows={4}
            error={errs.reason?.[0]}
          />

          {formError && (
            <div className="text-xs text-warn px-3 py-2 rounded-md bg-warn-soft border border-warn-border">
              {formError}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={isPending}>
              {isPending ? "Declining…" : "Decline lead"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
