/**
 * Mark-as-Sent Dialog (sendInvoice)
 *
 * NOTHING is emailed from here (docs/issues/invoice-email-not-sent.md).
 * The lawyer delivers the invoice themselves; this records how and to
 * whom, plus an optional trust application, and transitions an
 * approved invoice to "sent". The copy says so plainly so nobody
 * assumes the client received it.
 *
 * Channels:
 *   - Email: recipient pre-fills from client.email and is editable.
 *   - US mail: visible-but-disabled with a "coming soon" hint so
 *     the firm can see the option exists without being able to
 *     half-use it. Server-side rejects mail too as defense-in-
 *     depth.
 *
 * Apply trust:
 *   - Checkbox surfaces only when the viewer holds billing.apply_trust
 *     and the matter has trust > 0.
 *   - When ticked, an amount field appears defaulted to MIN(trust,
 *     invoice balance). Submission runs the send + four-leg trust
 *     payment in one transaction; coverage flips status to paid /
 *     partial accordingly.
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
import { Mail, Stamp, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { sendInvoice } from "@/app/actions/billing";
import {
  billingInitialState,
  type BillingFormState,
} from "@/lib/billing-form";
import { parseMoneyInput } from "@/lib/parse-money-input";

const formatMoney = (n: number): string =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function SendInvoiceDialog({
  open,
  onOpenChange,
  invoiceId,
  invoiceNumber,
  invoiceBalance,
  clientEmail,
  trustBalance,
  canApplyTrust = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  invoiceNumber: string;
  invoiceBalance: number;
  clientEmail: string | null;
  trustBalance: number;
  /** Whether the viewer holds `billing.apply_trust`. Applying trust
   *  at send moves client money and the server refuses it without
   *  the key, so the option is hidden for everyone else. */
  canApplyTrust?: boolean;
}) {
  const action = sendInvoice.bind(null, invoiceId);
  // Wrapped useActionState: masks state left over from a previous
  // open, so a failed attempt's error banner doesn't reappear when
  // the dialog is reopened. See src/hooks/use-dialog-action-state.ts.
  const [state, formAction, isPending] = useDialogActionState<
    BillingFormState,
    FormData
  >(action, billingInitialState, open);

  // The trust-apply checkbox only exists if there's trust to draw
  // from AND the invoice has an open balance.
  const trustEligible =
    canApplyTrust && trustBalance > 0 && invoiceBalance > 0;
  const defaultTrustApply = useMemo(
    () => Math.min(trustBalance, invoiceBalance),
    [trustBalance, invoiceBalance]
  );

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
          <DialogTitle>Mark invoice {invoiceNumber} as sent</DialogTitle>
          <DialogDescription>
            Nothing is emailed from here. Send the invoice to the client
            yourself (print or save it as a PDF), then record how and to
            whom you sent it.
          </DialogDescription>
        </DialogHeader>

        {/* Keyed on the seed inputs: a balance / email change while
            the dialog is open re-seeds the form, like a fresh open. */}
        <SendInvoiceForm
          key={`${defaultTrustApply}|${clientEmail ?? ""}`}
          state={state}
          formAction={formAction}
          isPending={isPending}
          onCancel={() => onOpenChange(false)}
          clientEmail={clientEmail}
          trustBalance={trustBalance}
          invoiceBalance={invoiceBalance}
          trustEligible={trustEligible}
          defaultTrustApply={defaultTrustApply}
        />
      </DialogContent>
    </Dialog>
  );
}

function SendInvoiceForm({
  state,
  formAction,
  isPending,
  onCancel,
  clientEmail,
  trustBalance,
  invoiceBalance,
  trustEligible,
  defaultTrustApply,
}: {
  state: BillingFormState;
  formAction: (payload: FormData) => void;
  isPending: boolean;
  onCancel: () => void;
  clientEmail: string | null;
  trustBalance: number;
  invoiceBalance: number;
  trustEligible: boolean;
  defaultTrustApply: number;
}) {
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
  const [method, setMethod] = useState<"email" | "mail">("email");
  const [recipient, setRecipient] = useState(clientEmail ?? "");
  const [applyTrust, setApplyTrust] = useState(false);
  const [trustAmount, setTrustAmount] = useState(
    defaultTrustApply.toFixed(2)
  );

  const errs = state.errors ?? {};
  // Same parse as the server's trustAmount schema — parseFloat
  // reads "1,200.00" as 1 and "$500" as NaN.
  const parsedTrustAmount = parseMoneyInput(trustAmount);
  const trustCap = Math.min(trustBalance, invoiceBalance);
  const trustUnparseable =
    applyTrust && trustAmount.trim() !== "" && parsedTrustAmount === null;
  const trustOver =
    applyTrust && parsedTrustAmount !== null && parsedTrustAmount > trustCap;
  const trustValid =
    !applyTrust ||
    (parsedTrustAmount !== null && parsedTrustAmount > 0 && !trustOver);

  const balanceAfter =
    applyTrust && trustValid && parsedTrustAmount !== null
      ? Math.max(0, invoiceBalance - parsedTrustAmount)
      : invoiceBalance;
  const willMarkPaid = applyTrust && trustValid && balanceAfter === 0;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      {/* Channel selector — segmented buttons. Mail is visible
          but disabled so the firm sees the surface area. */}
      <div className="flex flex-col gap-1">
        <span
          id={`${ids}-method`}
          className="text-2xs font-medium text-ink-3"
        >
          Sent via <span className="text-warn">*</span>
        </span>
        <input type="hidden" name="method" value={method} />
        <div
          role="group"
          aria-labelledby={`${ids}-method`}
          className="grid grid-cols-2 gap-2"
        >
          <button
            type="button"
            onClick={() => setMethod("email")}
            aria-pressed={method === "email"}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-md border text-xs",
              method === "email"
                ? "border-brand-500 bg-brand-soft text-brand-700"
                : "border-line bg-white text-ink hover:border-brand-300"
            )}
          >
            <Mail size={14} />
            <div className="text-left">
              <div className="font-medium">Email</div>
              <div className="text-2xs text-ink-4">You emailed it</div>
            </div>
          </button>
          <button
            type="button"
            disabled
            title="US mail integration is on the roadmap."
            className="flex items-center gap-2 px-3 py-2 rounded-md border border-line bg-paper-2/50 text-xs text-ink-4 cursor-not-allowed opacity-70"
          >
            <Stamp size={14} />
            <div className="text-left">
              <div className="font-medium">US mail</div>
              <div className="text-2xs">Coming soon</div>
            </div>
          </button>
        </div>
      </div>

      {/* Recipient — email today; mail will swap in a mailing
          address summary once the mail path lands. */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor={`${ids}-recipient`}
          className="text-2xs font-medium text-ink-3"
        >
          {method === "email" ? "Sent to (email)" : "Mailing address"}{" "}
          <span className="text-warn">*</span>
        </label>
        <input
          id={`${ids}-recipient`}
          name="recipient"
          type={method === "email" ? "email" : "text"}
          required
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder={
            method === "email" ? "client@example.com" : "Mailing address"
          }
          className={cn(
            "h-9 px-3 rounded-md border bg-white text-sm text-ink",
            "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
            errs.recipient ? "border-warn" : "border-line"
          )}
        />
        {errs.recipient && (
          <span className="text-2xs text-warn">{errs.recipient[0]}</span>
        )}
        {!clientEmail && method === "email" && (
          <span className="text-2xs text-ink-4">
            The client doesn&apos;t have an email on file — anything
            you enter here is one-shot.
          </span>
        )}
      </div>

      {/* Apply trust — collapsed checkbox; expands amount field
          when ticked. The hidden input mirrors the boolean so the
          server gets a stable "true"/"" pair regardless of
          styling. */}
      {trustEligible && (
        <div className="flex flex-col gap-2 px-3 py-2.5 rounded-md border border-line bg-paper-2/40">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={applyTrust}
              onChange={(e) => setApplyTrust(e.target.checked)}
              className="mt-0.5"
            />
            <input
              type="hidden"
              name="applyTrust"
              value={applyTrust ? "true" : ""}
            />
            <div className="text-xs">
              <div className="text-ink font-medium">
                Apply trust toward this invoice
              </div>
              <div className="text-2xs text-ink-4 mt-0.5">
                Trust balance: {formatMoney(trustBalance)} · invoice
                balance: {formatMoney(invoiceBalance)}
              </div>
            </div>
          </label>
          {applyTrust && (
            <div className="flex flex-col gap-1 pl-6">
              <label
                htmlFor={`${ids}-trust-amount`}
                className="text-2xs font-medium text-ink-3"
              >
                Amount
              </label>
              <input
                id={`${ids}-trust-amount`}
                name="trustAmount"
                type="text"
                inputMode="decimal"
                value={trustAmount}
                onChange={(e) => setTrustAmount(e.target.value)}
                className={cn(
                  "h-8 px-2.5 rounded-md border bg-white text-xs text-ink font-mono",
                  "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
                  trustOver || trustUnparseable
                    ? "border-warn"
                    : "border-line"
                )}
              />
              {trustUnparseable && (
                <span className="text-2xs text-warn">
                  Enter a valid amount.
                </span>
              )}
              {trustOver && (
                <span className="text-2xs text-warn">
                  Capped at {formatMoney(trustCap)} (limited by{" "}
                  {trustBalance < invoiceBalance ? "trust" : "invoice"}{" "}
                  balance).
                </span>
              )}
              {trustValid && (
                <span
                  className={cn(
                    "text-2xs font-mono",
                    willMarkPaid ? "text-ok" : "text-ink-4"
                  )}
                >
                  Balance after: {formatMoney(balanceAfter)}
                  {willMarkPaid && " · paid in full"}
                </span>
              )}
            </div>
          )}
        </div>
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
          disabled={
            isPending || method === "mail" || !recipient || !trustValid
          }
        >
          {isPending
            ? "Saving…"
            : willMarkPaid
              ? "Mark sent + paid from trust"
              : applyTrust && trustValid
                ? "Mark sent + apply trust"
                : "Mark as sent"}
        </Button>
      </DialogFooter>
    </form>
  );
}
