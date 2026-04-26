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
 * status flip) lands atomically server-side.
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
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { recordInvoicePayment } from "@/app/actions/billing";
import {
  billingInitialState,
  type BillingFormState,
} from "@/lib/billing-form";

const formatMoney = (n: number): string =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function ApplyTrustDialog({
  open,
  onOpenChange,
  invoiceId,
  invoiceNumber,
  invoiceBalance,
  trustBalance,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  invoiceNumber: string;
  invoiceBalance: number;
  trustBalance: number;
}) {
  const action = recordInvoicePayment.bind(null, invoiceId);
  const [state, formAction, isPending] = useActionState<
    BillingFormState,
    FormData
  >(action, billingInitialState);

  // Default to MIN(trust, invoice balance) — the most common case
  // is "earn out as much as the retainer covers."
  const defaultAmount = useMemo(() => {
    const n = Math.min(invoiceBalance, trustBalance);
    return n > 0 ? n.toFixed(2) : "0.00";
  }, [invoiceBalance, trustBalance]);

  const [amount, setAmount] = useState(defaultAmount);
  const [date, setDate] = useState(todayIso());

  useEffect(() => {
    if (!open) return;
    setAmount(defaultAmount);
    setDate(todayIso());
  }, [open, defaultAmount]);

  useEffect(() => {
    if (state.status === "ok") onOpenChange(false);
  }, [state.status, onOpenChange]);

  const errs = state.errors ?? {};
  const parsedAmount = parseFloat(amount);
  const validAmount = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const overTrust =
    Number.isFinite(parsedAmount) && parsedAmount > trustBalance;
  const overBalance =
    Number.isFinite(parsedAmount) && parsedAmount > invoiceBalance;

  const trustAfter = Number.isFinite(parsedAmount)
    ? Math.max(0, trustBalance - parsedAmount)
    : trustBalance;
  const invoiceAfter = Number.isFinite(parsedAmount)
    ? Math.max(0, invoiceBalance - parsedAmount)
    : invoiceBalance;
  const willMarkPaid = validAmount && invoiceAfter === 0;

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

        <form action={formAction} className="flex flex-col gap-3">
          {/* Locked source — this dialog is trust-only. The Record
              payment dialog handles other channels. */}
          <input type="hidden" name="source" value="trust" />

          {/* Context strip — trust + invoice balances with after-
              this-application previews. */}
          <div className="grid grid-cols-2 gap-2 text-2xs">
            <div className="px-3 py-2 rounded-md border border-line bg-paper-2/40">
              <div className="font-mono uppercase tracking-wider text-ink-4">
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
              <div className="font-mono uppercase tracking-wider text-ink-4">
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
            <label className="text-2xs font-mono uppercase tracking-wider text-ink-4">
              Amount <span className="text-warn">*</span>
            </label>
            <input
              name="amount"
              type="text"
              inputMode="decimal"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={cn(
                "h-9 px-3 rounded-md border bg-white text-sm text-ink font-mono",
                "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
                errs.amount || overTrust || overBalance
                  ? "border-warn"
                  : "border-line"
              )}
            />
            {errs.amount && (
              <span className="text-2xs text-warn">{errs.amount[0]}</span>
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
            <label className="text-2xs font-mono uppercase tracking-wider text-ink-4">
              Date
            </label>
            <input
              name="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-8 px-2 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 max-w-[12rem]"
            />
          </div>

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
                isPending || !validAmount || overTrust || overBalance
              }
            >
              {isPending
                ? "Applying…"
                : willMarkPaid
                  ? `Apply ${formatMoney(parsedAmount || 0)} · mark paid`
                  : `Apply ${formatMoney(parsedAmount || 0)} from trust`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
