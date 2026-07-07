/**
 * Send Invoice Dialog
 *
 * Captures the channel + recipient + optional trust application,
 * then transitions an approved invoice to "sent" via sendInvoice.
 *
 * Channels:
 *   - Email: today; recipient pre-fills from client.email and is
 *     editable. The actual SMTP send isn't wired up yet — sending
 *     is just logged. When Gmail integration lands the action will
 *     fire the real message before transitioning.
 *   - US mail: visible-but-disabled with a "coming soon" hint so
 *     the firm can see the option exists without being able to
 *     half-use it. Server-side rejects mail too as defense-in-
 *     depth.
 *
 * Apply trust:
 *   - Checkbox surfaces only when the matter has trust > 0.
 *   - When ticked, an amount field appears defaulted to MIN(trust,
 *     invoice balance). Submission runs the send + four-leg trust
 *     payment in one transaction; coverage flips status to paid /
 *     partial accordingly.
 */

"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  invoiceNumber: string;
  invoiceBalance: number;
  clientEmail: string | null;
  trustBalance: number;
}) {
  const action = sendInvoice.bind(null, invoiceId);
  const [state, formAction, isPending] = useActionState<
    BillingFormState,
    FormData
  >(action, billingInitialState);

  // The trust-apply checkbox only exists if there's trust to draw
  // from AND the invoice has an open balance.
  const trustEligible = trustBalance > 0 && invoiceBalance > 0;
  const defaultTrustApply = useMemo(
    () => Math.min(trustBalance, invoiceBalance),
    [trustBalance, invoiceBalance]
  );

  const [method, setMethod] = useState<"email" | "mail">("email");
  const [recipient, setRecipient] = useState(clientEmail ?? "");
  const [applyTrust, setApplyTrust] = useState(false);
  const [trustAmount, setTrustAmount] = useState(
    defaultTrustApply.toFixed(2)
  );

  useEffect(() => {
    if (!open) return;
    setMethod("email");
    setRecipient(clientEmail ?? "");
    setApplyTrust(false);
    setTrustAmount(defaultTrustApply.toFixed(2));
  }, [open, clientEmail, defaultTrustApply]);

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

  const errs = state.errors ?? {};
  const parsedTrustAmount = parseFloat(trustAmount);
  const trustOver =
    applyTrust &&
    Number.isFinite(parsedTrustAmount) &&
    parsedTrustAmount > Math.min(trustBalance, invoiceBalance);
  const trustValid =
    !applyTrust ||
    (Number.isFinite(parsedTrustAmount) &&
      parsedTrustAmount > 0 &&
      !trustOver);

  const balanceAfter = applyTrust && trustValid
    ? Math.max(0, invoiceBalance - parsedTrustAmount)
    : invoiceBalance;
  const willMarkPaid = applyTrust && trustValid && balanceAfter === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send invoice {invoiceNumber}</DialogTitle>
          <DialogDescription>
            Records the send event and transitions the invoice to sent.
            Actual delivery isn&apos;t wired up yet — for now this just
            logs the activity.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-3">
          {/* Channel selector — segmented buttons. Mail is visible
              but disabled so the firm sees the surface area. */}
          <div className="flex flex-col gap-1">
            <label className="text-2xs font-mono uppercase tracking-wider text-ink-4">
              Send via <span className="text-warn">*</span>
            </label>
            <input type="hidden" name="method" value={method} />
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMethod("email")}
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
                  <div className="text-2xs text-ink-4">
                    Logged-only for now
                  </div>
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
            <label className="text-2xs font-mono uppercase tracking-wider text-ink-4">
              {method === "email" ? "Email recipient" : "Mailing address"}{" "}
              <span className="text-warn">*</span>
            </label>
            <input
              name="recipient"
              type={method === "email" ? "email" : "text"}
              required
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder={
                method === "email"
                  ? "client@example.com"
                  : "Mailing address"
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
                  <label className="text-2xs font-mono uppercase tracking-wider text-ink-4">
                    Amount
                  </label>
                  <input
                    name="trustAmount"
                    type="text"
                    inputMode="decimal"
                    value={trustAmount}
                    onChange={(e) => setTrustAmount(e.target.value)}
                    className={cn(
                      "h-8 px-2.5 rounded-md border bg-white text-xs text-ink font-mono",
                      "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
                      trustOver ? "border-warn" : "border-line"
                    )}
                  />
                  {trustOver && (
                    <span className="text-2xs text-warn">
                      Capped at {formatMoney(Math.min(trustBalance, invoiceBalance))} (limited by{" "}
                      {trustBalance < invoiceBalance ? "trust" : "invoice"} balance).
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
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                isPending || method === "mail" || !recipient || !trustValid
              }
            >
              {isPending
                ? "Sending…"
                : willMarkPaid
                  ? "Send + mark paid from trust"
                  : applyTrust && trustValid
                    ? "Send + apply trust"
                    : "Send invoice"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
