/**
 * Decline Lead Button + Dialog
 *
 * Replaces the disabled "Decline" placeholder in the lead detail
 * topbar. Captures an optional reason and marks the lead's stage
 * "declined". The lead leaves the active queue and the topbar pivots
 * to the resolved state.
 */

"use client";

import { useActionState, useEffect, useState } from "react";
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
import {
  declineLeadInitialState,
  type DeclineLeadFormState,
} from "@/lib/lead-conversion-form";

export function DeclineLeadButton({ leadId }: { leadId: string }) {
  const [open, setOpen] = useState(false);
  const action = declineLead.bind(null, leadId);
  const [state, formAction, isPending] = useActionState<
    DeclineLeadFormState,
    FormData
  >(action, declineLeadInitialState);

  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  // Close on success — server revalidation re-renders the layout with
  // the resolved-lead topbar variant.
  useEffect(() => {
    if (state.status === "ok") setOpen(false);
  }, [state.status]);

  const errs = state.errors ?? {};
  const formError = errs._form?.[0];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
            Mark this lead as declined and remove it from the active intake
            queue. The reason is internal — it stays on the lead for future
            reference but isn&apos;t shared with the prospective client.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-3">
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
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
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
