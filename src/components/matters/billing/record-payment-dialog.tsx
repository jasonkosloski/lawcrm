/**
 * Record Payment Dialog
 *
 * Logs a payment received against a sent or partially-paid client
 * invoice. Channel options: check, ACH, cash, card, other — plus
 * trust when the matter has a trust balance. Trust selections run
 * the four-leg op (trust ledger row + balance decrement + invoice
 * paidAmount increment + InvoicePayment row) atomically.
 *
 * The dialog defaults the amount to the open balance so the common
 * "paid in full" case is one click. A payment that fully covers
 * the balance flips the invoice to "paid"; a partial payment moves
 * it to "partial" so the row stays surfaced as still-owing money.
 *
 * Structure: the outer component owns the action state (it stays
 * mounted across close/reopen) and the close-on-success effect; the
 * form body is a child of DialogContent, which unmounts on close, so
 * its working copies are re-seeded from props on every open without
 * a reset effect.
 */

"use client";

import { useEffect, useId, useMemo, useState, useTransition } from "react";
import { notifyWarning } from "@/lib/feedback";
import { useDialogActionState } from "@/hooks/use-dialog-action-state";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
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
import { recordInvoicePayment } from "@/app/actions/billing";
import {
  billingInitialState,
  INVOICE_PAYMENT_SOURCE_LABEL,
  type BillingFormState,
  type InvoicePaymentSource,
} from "@/lib/billing-form";
import { todayKey } from "@/lib/format-date";
import { parseMoneyInput } from "@/lib/parse-money-input";
import { useUserTimeZone } from "@/components/user-time-zone";
import { formatMoney } from "@/lib/format-money";
import { inputClass, textareaClass, FormErrorBanner } from "@/components/ui/field";

// Reference field placeholder hints at what the firm typically
// captures per channel. Cosmetic — the field accepts anything.
const REFERENCE_PLACEHOLDER: Record<InvoicePaymentSource, string> = {
  check: "Check #",
  ach: "Wire / ACH confirmation",
  cash: "Receipt #",
  card: "Last 4 / auth code",
  other: "Reference",
  trust: "Optional",
};

export function RecordPaymentDialog({
  open,
  onOpenChange,
  invoiceId,
  invoiceNumber,
  invoiceBalance,
  trustBalance,
  clientEmail,
  canApplyTrust = false,
  canSendInvoice = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  invoiceNumber: string;
  invoiceBalance: number;
  /** Matter's current trust balance — surfaces the Trust option in
   *  the method dropdown when > 0. Server runs the four-leg trust
   *  op when source=trust. */
  trustBalance: number;
  /** Drives the "Client needs an updated invoice" checkbox at the bottom of
   *  the dialog. When null the checkbox is shown disabled with a
   *  "no email on file" hint so the lawyer knows why they can't
   *  notify. */
  clientEmail: string | null;
  /** Whether the viewer holds `billing.apply_trust`. Paying from
   *  trust moves client money and the server refuses source=trust
   *  without the key, so the Trust method is hidden for everyone
   *  else. Defaults to false (hidden) so a caller that forgets the
   *  prop can't expose the option. */
  canApplyTrust?: boolean;
  /** billing.send_invoice: emailing the updated invoice is part of it,
   *  so without it the "Send updated invoice" checkbox is hidden. */
  canSendInvoice?: boolean;
}) {
  // Trust appears as a method only when the viewer may apply trust
  // AND the matter actually has funds in trust to draw from. Other
  // channels are always available.
  const selectableSources: InvoicePaymentSource[] = [
    "check",
    "ach",
    "cash",
    "card",
    "other",
    ...(canApplyTrust && trustBalance > 0 ? (["trust"] as const) : []),
  ];
  const action = recordInvoicePayment.bind(null, invoiceId);
  // Wrapped useActionState: masks state left over from a previous
  // open, so a failed attempt's error banner doesn't reappear when
  // the dialog is reopened. See src/hooks/use-dialog-action-state.ts.
  const [state, formAction, isPending] = useDialogActionState<BillingFormState, FormData>(
    action,
    billingInitialState,
    open,
  );

  // Default to "pay in full" — matches the "Mark paid" muscle
  // memory while still letting the user step down for a partial.
  const defaultAmount = useMemo(
    () => (invoiceBalance > 0 ? invoiceBalance.toFixed(2) : "0.00"),
    [invoiceBalance],
  );

  // Close on success. Deps must be the state OBJECT, not
  // state.status: useActionState keeps its state across
  // submissions, so after the first success the status string is
  // "ok" forever. Keying on the string means a second successful
  // payment (partial → reopen → pay the rest) returns a fresh
  // object whose status compares equal, the effect skips, and the
  // dialog silently stays open — inviting a duplicate submission.
  // Each action invocation returns a new object, so identity is
  // the reliable "a submission just finished" signal.
  useEffect(() => {
    if (state.status === "ok") {
      if (state.warning) notifyWarning(state.warning);
      onOpenChange(false);
    }
  }, [state, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record payment for {invoiceNumber}</DialogTitle>
          <DialogDescription>
            Logs a payment received against this invoice. Recording the full balance flips the
            status to paid; partial payments leave it open with a reduced balance.
          </DialogDescription>
        </DialogHeader>

        {/* Keyed on the seed inputs: a balance / email change while
            the dialog is open re-seeds the form, like a fresh open. */}
        <RecordPaymentForm
          key={`${defaultAmount}|${clientEmail ?? ""}`}
          state={state}
          formAction={formAction}
          isPending={isPending}
          onCancel={() => onOpenChange(false)}
          defaultAmount={defaultAmount}
          invoiceBalance={invoiceBalance}
          trustBalance={trustBalance}
          clientEmail={clientEmail}
          canSendInvoice={canSendInvoice}
          selectableSources={selectableSources}
        />
      </DialogContent>
    </Dialog>
  );
}

function RecordPaymentForm({
  state,
  formAction,
  isPending,
  onCancel,
  defaultAmount,
  invoiceBalance,
  trustBalance,
  clientEmail,
  canSendInvoice,
  selectableSources,
}: {
  state: BillingFormState;
  formAction: (payload: FormData) => void;
  isPending: boolean;
  onCancel: () => void;
  defaultAmount: string;
  invoiceBalance: number;
  trustBalance: number;
  clientEmail: string | null;
  canSendInvoice: boolean;
  selectableSources: InvoicePaymentSource[];
}) {
  const tz = useUserTimeZone();
  const ids = useId();
  // Dispatch via onSubmit + startTransition instead of
  // <form action={formAction}>: React 19 resets the form after the
  // action settles — error or not — and a reset snaps even a
  // controlled <select> back to its first option (the typed
  // Method would silently revert to "Check" after a server error).
  // A manual dispatch keeps the user's input so they can correct
  // and resubmit. Native `required` validation still runs first.
  const [, startSubmit] = useTransition();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startSubmit(() => formAction(fd));
  };
  // Working copies, seeded when the form mounts (= on every open).
  const [amount, setAmount] = useState(defaultAmount);
  const [date, setDate] = useState(() => todayKey(tz));
  const [source, setSource] = useState<InvoicePaymentSource>("check");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  // Opt-in: this sends a real email to the client, so it starts
  // unchecked. With no email on file the checkbox stays disabled.
  const [notifyClient, setNotifyClient] = useState(false);

  const errs = state.errors ?? {};
  // Same parse as the server's amount schema ("$1,200.00" is
  // $1,200.00) — parseFloat would read it as $1.00.
  const parsedAmount = parseMoneyInput(amount);
  const amountUnparseable = amount.trim() !== "" && parsedAmount === null;
  const validAmount = parsedAmount !== null && parsedAmount > 0;
  const overBalance = parsedAmount !== null && parsedAmount > invoiceBalance;
  const overTrust = source === "trust" && parsedAmount !== null && parsedAmount > trustBalance;
  const balanceAfter =
    parsedAmount !== null ? Math.max(0, invoiceBalance - parsedAmount) : invoiceBalance;
  const willMarkPaid = validAmount && balanceAfter === 0;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      {/* Context strip — just the invoice side. No trust here. */}
      <div className="grid grid-cols-2 gap-2 text-2xs">
        <div className="px-3 py-2 rounded-md border border-line bg-paper-2/40">
          <div className="text-2xs font-medium text-ink-3">Open balance</div>
          <div className="text-ink font-mono mt-0.5">{formatMoney(invoiceBalance)}</div>
        </div>
        <div className="px-3 py-2 rounded-md border border-line bg-paper-2/40">
          <div className="text-2xs font-medium text-ink-3">After this payment</div>
          <div className={cn("text-ink font-mono mt-0.5", willMarkPaid && "text-ok")}>
            {formatMoney(balanceAfter)}
            {willMarkPaid && " · paid"}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${ids}-amount`} className="text-2xs font-medium text-ink-3">
          Amount <span className="text-warn">*</span>
        </label>
        <input
          id={`${ids}-amount`}
          name="amount"
          type="text"
          inputMode="decimal"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={cn(
            inputClass(!!(errs.amount || amountUnparseable || overBalance || overTrust), "md"),
            "text-sm font-mono",
          )}
        />
        {errs.amount && <span className="text-2xs text-warn">{errs.amount[0]}</span>}
        {!errs.amount && amountUnparseable && (
          <span className="text-2xs text-warn">Enter a valid amount.</span>
        )}
        {!errs.amount && overBalance && (
          <span className="text-2xs text-warn">
            Exceeds the invoice balance — record the balance or less.
          </span>
        )}
        {!errs.amount && !overBalance && overTrust && (
          <span className="text-2xs text-warn">
            Exceeds the trust balance — drop the amount or pick a different method.
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-source`} className="text-2xs font-medium text-ink-3">
            Method <span className="text-warn">*</span>
          </label>
          <NativeSelect
            className="w-full"
            id={`${ids}-source`}
            name="source"
            required
            value={source}
            onChange={(e) => setSource(e.target.value as InvoicePaymentSource)}
          >
            {selectableSources.map((s) => (
              <NativeSelectOption key={s} value={s}>
                {INVOICE_PAYMENT_SOURCE_LABEL[s]}
                {s === "trust" && ` (avail: ${formatMoney(trustBalance)})`}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-date`} className="text-2xs font-medium text-ink-3">
            Date
          </label>
          <input
            id={`${ids}-date`}
            name="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass()}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${ids}-reference`} className="text-2xs font-medium text-ink-3">
          Reference
        </label>
        <input
          id={`${ids}-reference`}
          name="reference"
          type="text"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder={REFERENCE_PLACEHOLDER[source]}
          maxLength={120}
          className={inputClass()}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${ids}-description`} className="text-2xs font-medium text-ink-3">
          Memo
        </label>
        <textarea
          id={`${ids}-description`}
          name="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional — appears on the invoice's payment row"
          rows={2}
          maxLength={400}
          className={cn(textareaClass(), "resize-none")}
        />
      </div>

      {/* Notify-client opt-in (unchecked by default; hidden without
          billing.send_invoice). The hidden input mirrors the boolean
          so the server reads "true" / "" cleanly. */}
      {canSendInvoice && (
        <label
          className={cn(
            "flex items-start gap-2 px-3 py-2 rounded-md border text-xs",
            clientEmail
              ? "cursor-pointer border-line bg-paper-2/40 hover:bg-paper-2/60"
              : "border-line bg-paper-2/30 cursor-not-allowed opacity-70",
          )}
        >
          <input
            type="checkbox"
            checked={notifyClient && !!clientEmail}
            disabled={!clientEmail}
            onChange={(e) => setNotifyClient(e.target.checked)}
            className="mt-0.5"
          />
          <input
            type="hidden"
            name="notifyClient"
            value={notifyClient && clientEmail ? "true" : ""}
          />
          <div>
            <div className="text-ink font-medium">Client needs an updated invoice</div>
            <div className="text-2xs text-ink-4 mt-0.5">
              {clientEmail
                ? `Emails the refreshed invoice PDF to ${clientEmail}.`
                : "No email on file for the client — add one on the client record to enable this."}
            </div>
          </div>
        </label>
      )}

      {state.status === "error" && state.error && <FormErrorBanner message={state.error} />}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending || !validAmount || overBalance || overTrust}>
          {isPending
            ? "Recording…"
            : willMarkPaid
              ? `Record ${formatMoney(parsedAmount ?? 0)} · mark paid`
              : `Record ${formatMoney(parsedAmount ?? 0)}`}
        </Button>
      </DialogFooter>
    </form>
  );
}
