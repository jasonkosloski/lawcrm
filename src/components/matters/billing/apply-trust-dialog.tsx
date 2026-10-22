/**
 * Apply Trust Dialog
 *
 * Focused dialog for the "earn out my retainer" flow — applies an
 * earned-fee transfer from the matter trust account against an
 * outstanding invoice. Distinct from the generic Record-payment
 * dialog: this one is locked to source=trust, defaults the amount
 * to MIN(trust, balance), and skips the channel/memo fields the
 * lawyer doesn't think about for this case.
 *
 * Both surfaces ultimately call recordInvoicePayment with
 * source=trust — so the four-leg op (trust ledger row, trust
 * balance decrement, InvoicePayment row, invoice paidAmount +
 * status flip) lands atomically server-side. The server stacks
 * billing.record_payment AND billing.apply_trust for it;
 * InvoiceActionBar only renders this dialog for viewers holding
 * both.
 *
 * Structure: the outer component owns the action state (it stays
 * mounted across close/reopen) and the close-on-success effect; the
 * form body is a child of DialogContent, which unmounts on close, so
 * its working copies are re-seeded from props on every open.
 */

"use client";

import { useEffect, useId, useMemo, useState, useTransition } from "react";
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
import { recordInvoicePayment } from "@/app/actions/billing";
import {
  billingInitialState,
  type BillingFormState,
} from "@/lib/billing-form";
import { todayKey } from "@/lib/format-date";
import { parseMoneyInput } from "@/lib/parse-money-input";
import { useUserTimeZone } from "@/components/user-time-zone";
import { formatMoney } from "@/lib/format-money";
import { inputClass, FormErrorBanner } from "@/components/ui/field";

export function ApplyTrustDialog({
  open,
  onOpenChange,
  invoiceId,
  invoiceNumber,
  invoiceBalance,
  trustBalance,
  clientEmail,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  invoiceNumber: string;
  invoiceBalance: number;
  trustBalance: number;
  /** Drives the "Client needs an updated invoice" checkbox at the bottom of
   *  the dialog. Disabled with a hint when null. */
  clientEmail: string | null;
}) {
  const action = recordInvoicePayment.bind(null, invoiceId);
  // Wrapped useActionState: masks state left over from a previous
  // open, so a failed attempt's error banner doesn't reappear when
  // the dialog is reopened. See src/hooks/use-dialog-action-state.ts.
  const [state, formAction, isPending] = useDialogActionState<
    BillingFormState,
    FormData
  >(action, billingInitialState, open);

  // Default to MIN(trust, invoice balance) — the most common case
  // is "earn out as much as the retainer covers."
  const defaultAmount = useMemo(() => {
    const n = Math.min(invoiceBalance, trustBalance);
    return n > 0 ? n.toFixed(2) : "0.00";
  }, [invoiceBalance, trustBalance]);

  // Close on success. Deps key on the state OBJECT, not
  // state.status: useActionState keeps its state across
  // submissions, so after the first success the status string is
  // "ok" forever and a second success would skip the effect,
  // leaving the dialog open. Each action invocation returns a
  // fresh object, so identity is the reliable "a submission just
  // finished" signal.
  useEffect(() => {
    if (state.status === "ok") onOpenChange(false);
  }, [state, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Apply trust to {invoiceNumber}</DialogTitle>
          <DialogDescription>
            Records an earned-fee transfer from the matter&apos;s IOLTA
            balance against this invoice. All four legs (trust ledger,
            trust balance, invoice paidAmount + status, payment record)
            update in one transaction.
          </DialogDescription>
        </DialogHeader>

        {/* Keyed on the seed inputs: a balance / email change while
            the dialog is open re-seeds the form, like a fresh open. */}
        <ApplyTrustForm
          key={`${defaultAmount}|${clientEmail ?? ""}`}
          state={state}
          formAction={formAction}
          isPending={isPending}
          onCancel={() => onOpenChange(false)}
          defaultAmount={defaultAmount}
          invoiceBalance={invoiceBalance}
          trustBalance={trustBalance}
          clientEmail={clientEmail}
        />
      </DialogContent>
    </Dialog>
  );
}

function ApplyTrustForm({
  state,
  formAction,
  isPending,
  onCancel,
  defaultAmount,
  invoiceBalance,
  trustBalance,
  clientEmail,
}: {
  state: BillingFormState;
  formAction: (payload: FormData) => void;
  isPending: boolean;
  onCancel: () => void;
  defaultAmount: string;
  invoiceBalance: number;
  trustBalance: number;
  clientEmail: string | null;
}) {
  const tz = useUserTimeZone();
  const ids = useId();
  // Dispatch via onSubmit + startTransition instead of
  // <form action={formAction}>: React 19 resets the form after the
  // action settles — error or not — wiping what the user typed when
  // the server refuses. A manual dispatch keeps the input so they
  // can correct and resubmit. Native `required` validation still
  // runs first.
  const [, startSubmit] = useTransition();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startSubmit(() => formAction(fd));
  };
  // Working copies, seeded when the form mounts (= on every open).
  const [amount, setAmount] = useState(defaultAmount);
  const [date, setDate] = useState(() => todayKey(tz));
  // See RecordPaymentDialog: default checked when there's an email
  // to send to; disabled when not.
  const [notifyClient, setNotifyClient] = useState(!!clientEmail);

  const errs = state.errors ?? {};
  // Same parse as the server's amount schema ("$1,200.00" is
  // $1,200.00) — parseFloat would read it as $1.00.
  const parsedAmount = parseMoneyInput(amount);
  const amountUnparseable = amount.trim() !== "" && parsedAmount === null;
  const validAmount = parsedAmount !== null && parsedAmount > 0;
  const overTrust = parsedAmount !== null && parsedAmount > trustBalance;
  const overBalance = parsedAmount !== null && parsedAmount > invoiceBalance;

  const trustAfter =
    parsedAmount !== null
      ? Math.max(0, trustBalance - parsedAmount)
      : trustBalance;
  const invoiceAfter =
    parsedAmount !== null
      ? Math.max(0, invoiceBalance - parsedAmount)
      : invoiceBalance;
  const willMarkPaid = validAmount && invoiceAfter === 0;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      {/* Locked source — this dialog is trust-only. The Record
          payment dialog handles other channels. */}
      <input type="hidden" name="source" value="trust" />

      {/* Context strip — trust + invoice balances with after-
          this-application previews. */}
      <div className="grid grid-cols-2 gap-2 text-2xs">
        <div className="px-3 py-2 rounded-md border border-line bg-paper-2/40">
          <div className="text-2xs font-medium text-ink-3">
            Trust balance
          </div>
          <div className="text-ink font-mono mt-0.5">
            {formatMoney(trustBalance)}
          </div>
          <div
            className={cn(
              "text-2xs font-mono mt-0.5",
              overTrust ? "text-warn" : "text-ink-4"
            )}
          >
            after: {formatMoney(trustAfter)}
          </div>
        </div>
        <div className="px-3 py-2 rounded-md border border-line bg-paper-2/40">
          <div className="text-2xs font-medium text-ink-3">
            Invoice balance
          </div>
          <div className="text-ink font-mono mt-0.5">
            {formatMoney(invoiceBalance)}
          </div>
          <div
            className={cn(
              "text-2xs font-mono mt-0.5",
              willMarkPaid ? "text-ok" : "text-ink-4"
            )}
          >
            after: {formatMoney(invoiceAfter)}
            {willMarkPaid && " · paid"}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor={`${ids}-amount`}
          className="text-2xs font-medium text-ink-3"
        >
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
          className={cn(inputClass(!!(errs.amount || amountUnparseable || overTrust || overBalance), "md"), "text-sm font-mono")}
        />
        {errs.amount && (
          <span className="text-2xs text-warn">{errs.amount[0]}</span>
        )}
        {!errs.amount && amountUnparseable && (
          <span className="text-2xs text-warn">Enter a valid amount.</span>
        )}
        {!errs.amount && overTrust && (
          <span className="text-2xs text-warn">
            Exceeds the trust balance — drop the amount or deposit
            more trust first.
          </span>
        )}
        {!errs.amount && !overTrust && overBalance && (
          <span className="text-2xs text-warn">
            Exceeds the invoice balance — pay the balance or less.
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor={`${ids}-date`}
          className="text-2xs font-medium text-ink-3"
        >
          Date
        </label>
        <input
          id={`${ids}-date`}
          name="date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={cn(inputClass(), "max-w-[12rem]")}
        />
      </div>

      {/* Notify-client opt-out — see RecordPaymentDialog for the
          full rationale; same shape so the lawyer sees a
          consistent control across both dialogs. */}
      <label
        className={cn(
          "flex items-start gap-2 px-3 py-2 rounded-md border text-xs",
          clientEmail
            ? "cursor-pointer border-line bg-paper-2/40 hover:bg-paper-2/60"
            : "border-line bg-paper-2/30 cursor-not-allowed opacity-70"
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
          <div className="text-ink font-medium">
            Client needs an updated invoice
          </div>
          <div className="text-2xs text-ink-4 mt-0.5">
            {clientEmail
              ? `Logs that ${clientEmail} should get a refreshed copy reflecting the trust application. Nothing is emailed — send it yourself.`
              : "No email on file for the client — add one on the client record to enable this."}
          </div>
        </div>
      </label>

      {state.status === "error" && state.error && <FormErrorBanner message={state.error} />}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={isPending || !validAmount || overTrust || overBalance}
        >
          {isPending
            ? "Applying…"
            : willMarkPaid
              ? `Apply ${formatMoney(parsedAmount ?? 0)} · mark paid`
              : `Apply ${formatMoney(parsedAmount ?? 0)} from trust`}
        </Button>
      </DialogFooter>
    </form>
  );
}
