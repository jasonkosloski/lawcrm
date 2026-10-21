/**
 * Void Invoice Dialog (voidInvoice)
 *
 * Voids a sent client invoice. Filed copies are stamped VOID; viewers
 * who may send invoices can also email the client a voided copy
 * (ticked by default, recipient pre-filled and required while ticked).
 * A partial result (`warning`) surfaces as a warning toast.
 *
 * Structure mirrors resend-invoice-dialog.tsx: the outer component owns
 * the action state and the close-on-success effect; the form body
 * unmounts with DialogContent so its fields re-seed on every open.
 */

"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { TriangleAlert } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { voidInvoice } from "@/app/actions/billing";
import {
  billingInitialState,
  type BillingFormState,
} from "@/lib/billing-form";
import { notifySuccess, notifyWarning } from "@/lib/feedback";

export function VoidInvoiceDialog({
  open,
  onOpenChange,
  invoiceId,
  invoiceNumber,
  clientEmail,
  canSendInvoice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  invoiceNumber: string;
  clientEmail: string | null;
  canSendInvoice: boolean;
}) {
  const action = voidInvoice.bind(null, invoiceId);
  const [state, formAction, isPending] = useDialogActionState<
    BillingFormState,
    FormData
  >(action, billingInitialState, open);

  // Keyed on the state object: each submission returns a fresh one.
  useEffect(() => {
    if (state.status !== "ok") return;
    if (state.warning) notifyWarning(state.warning);
    else notifySuccess("Invoice voided.");
    onOpenChange(false);
  }, [state, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Void invoice {invoiceNumber}</DialogTitle>
          <DialogDescription>
            Voiding returns its time and expenses to unbilled. Filed copies are
            stamped VOID.
          </DialogDescription>
        </DialogHeader>
        <VoidInvoiceForm
          key={clientEmail ?? ""}
          state={state}
          formAction={formAction}
          isPending={isPending}
          onCancel={() => onOpenChange(false)}
          clientEmail={clientEmail}
          canSendInvoice={canSendInvoice}
        />
      </DialogContent>
    </Dialog>
  );
}

function VoidInvoiceForm({
  state,
  formAction,
  isPending,
  onCancel,
  clientEmail,
  canSendInvoice,
}: {
  state: BillingFormState;
  formAction: (payload: FormData) => void;
  isPending: boolean;
  onCancel: () => void;
  clientEmail: string | null;
  canSendInvoice: boolean;
}) {
  const id = useId();
  // onSubmit + startTransition instead of <form action>: React 19
  // resets the form after the action settles, wiping inputs on error.
  const [, startSubmit] = useTransition();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startSubmit(() => formAction(fd));
  };
  const [notify, setNotify] = useState(true);
  const [recipient, setRecipient] = useState(clientEmail ?? "");
  const errs = state.errors ?? {};
  const emailing = canSendInvoice && notify;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      {canSendInvoice && (
        <>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              name="notifyClient"
              value="true"
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
            />
            Email the client a voided copy
          </label>
          {notify && (
            <div className="flex flex-col gap-1">
              <label htmlFor={id} className="text-2xs font-medium text-ink-3">
                Recipient <span className="text-warn">*</span>
              </label>
              <input
                id={id}
                name="recipient"
                type="email"
                required
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="client@example.com"
                className={cn(
                  "h-9 px-3 rounded-md border bg-white text-sm text-ink",
                  "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
                  errs.recipient ? "border-warn" : "border-line"
                )}
              />
              {errs.recipient && (
                <span className="text-2xs text-warn">{errs.recipient[0]}</span>
              )}
            </div>
          )}
        </>
      )}

      {state.status === "error" && state.error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-warn-soft border border-warn-border text-2xs text-warn">
          <TriangleAlert size={12} className="shrink-0 mt-px" />
          <span>{state.error}</span>
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="destructive"
          disabled={isPending || (emailing && !recipient)}
        >
          {isPending ? "Voiding…" : "Void invoice"}
        </Button>
      </DialogFooter>
    </form>
  );
}
