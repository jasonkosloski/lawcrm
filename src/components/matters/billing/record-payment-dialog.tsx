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
  INVOICE_PAYMENT_SOURCE_LABEL,
  type BillingFormState,
  type InvoicePaymentSource,
} from "@/lib/billing-form";

const formatMoney = (n: number): string =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

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
}) {
  // Trust appears as a method only when the matter actually has
  // funds in trust to draw from. Other channels are always
  // available.
  const selectableSources: InvoicePaymentSource[] = [
    "check",
    "ach",
    "cash",
    "card",
    "other",
    ...(trustBalance > 0 ? (["trust"] as const) : []),
  ];
  const action = recordInvoicePayment.bind(null, invoiceId);
  const [state, formAction, isPending] = useActionState<
    BillingFormState,
    FormData
  >(action, billingInitialState);

  // Default to "pay in full" — matches the "Mark paid" muscle
  // memory while still letting the user step down for a partial.
  const defaultAmount = useMemo(
    () => (invoiceBalance > 0 ? invoiceBalance.toFixed(2) : "0.00"),
    [invoiceBalance]
  );

  const [amount, setAmount] = useState(defaultAmount);
  const [date, setDate] = useState(todayIso());
  const [source, setSource] = useState<InvoicePaymentSource>("check");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open) return;
    setAmount(defaultAmount);
    setDate(todayIso());
    setSource("check");
    setReference("");
    setDescription("");
  }, [open, defaultAmount]);

  useEffect(() => {
    if (state.status === "ok") onOpenChange(false);
  }, [state.status, onOpenChange]);

  const errs = state.errors ?? {};
  const parsedAmount = parseFloat(amount);
  const validAmount = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const overBalance =
    Number.isFinite(parsedAmount) && parsedAmount > invoiceBalance;
  const overTrust =
    source === "trust" &&
    Number.isFinite(parsedAmount) &&
    parsedAmount > trustBalance;
  const balanceAfter = Number.isFinite(parsedAmount)
    ? Math.max(0, invoiceBalance - parsedAmount)
    : invoiceBalance;
  const willMarkPaid = validAmount && balanceAfter === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record payment for {invoiceNumber}</DialogTitle>
          <DialogDescription>
            Logs a payment received against this invoice. Recording the
            full balance flips the status to paid; partial payments leave
            it open with a reduced balance.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-3">
          {/* Context strip — just the invoice side. No trust here. */}
          <div className="grid grid-cols-2 gap-2 text-2xs">
            <div className="px-3 py-2 rounded-md border border-line bg-paper-2/40">
              <div className="font-mono uppercase tracking-wider text-ink-4">
                Open balance
              </div>
              <div className="text-ink font-mono mt-0.5">
                {formatMoney(invoiceBalance)}
              </div>
            </div>
            <div className="px-3 py-2 rounded-md border border-line bg-paper-2/40">
              <div className="font-mono uppercase tracking-wider text-ink-4">
                After this payment
              </div>
              <div
                className={cn(
                  "text-ink font-mono mt-0.5",
                  willMarkPaid && "text-ok"
                )}
              >
                {formatMoney(balanceAfter)}
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
                errs.amount || overBalance || overTrust
                  ? "border-warn"
                  : "border-line"
              )}
            />
            {errs.amount && (
              <span className="text-2xs text-warn">{errs.amount[0]}</span>
            )}
            {!errs.amount && overBalance && (
              <span className="text-2xs text-warn">
                Exceeds the invoice balance — record the balance or less.
              </span>
            )}
            {!errs.amount && !overBalance && overTrust && (
              <span className="text-2xs text-warn">
                Exceeds the trust balance — drop the amount or pick a
                different method.
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-2xs font-mono uppercase tracking-wider text-ink-4">
                Method <span className="text-warn">*</span>
              </label>
              <select
                name="source"
                required
                value={source}
                onChange={(e) =>
                  setSource(e.target.value as InvoicePaymentSource)
                }
                className="h-8 px-2 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30"
              >
                {selectableSources.map((s) => (
                  <option key={s} value={s}>
                    {INVOICE_PAYMENT_SOURCE_LABEL[s]}
                    {s === "trust" && ` (avail: $${trustBalance.toFixed(2)})`}
                  </option>
                ))}
              </select>
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
                className="h-8 px-2 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-2xs font-mono uppercase tracking-wider text-ink-4">
              Reference
            </label>
            <input
              name="reference"
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={REFERENCE_PLACEHOLDER[source]}
              maxLength={120}
              className="h-8 px-2.5 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-2xs font-mono uppercase tracking-wider text-ink-4">
              Memo
            </label>
            <textarea
              name="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional — appears on the invoice's payment row"
              rows={2}
              maxLength={400}
              className="px-2.5 py-1.5 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4 resize-none"
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
                isPending || !validAmount || overBalance || overTrust
              }
            >
              {isPending
                ? "Recording…"
                : willMarkPaid
                  ? `Record ${formatMoney(parsedAmount || 0)} · mark paid`
                  : `Record ${formatMoney(parsedAmount || 0)}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
