/**
 * Shared pieces of the matter Billing tab sections: money / date
 * formatters, status + trust-type labels, the permissions shape, and
 * the KPI tile.
 */

import { Card, CardContent } from "@/components/ui/card";
import { formatDateOnly } from "@/lib/format-date";

export const formatMoney = (n: number): string =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Billing dates on this page are a mix of date-only values (expense /
// payment / trust-transaction dates: shown on their stored calendar
// day, no zone) and instants (invoice issue/due, minted with
// `new Date()`: shown in the viewer's profile zone). ADR-012.
export const formatDay = (d: Date): string => formatDateOnly(d, "medium");

/** Which mutating billing controls the viewer's keys allow. */
export type BillingPermissions = {
  generateInvoice: boolean;
  approveInvoice: boolean;
  sendInvoice: boolean;
  recordPayment: boolean;
  applyTrust: boolean;
  voidInvoice: boolean;
  deleteDraft: boolean;
  recordTrustTransaction: boolean;
};

export const STATUS_META: Record<string, string> = {
  draft: "bg-paper-2 text-ink-3 border-line",
  approved: "bg-brand-soft/60 text-brand-700 border-brand-200",
  sent: "bg-brand-soft text-brand-700 border-brand-200",
  partial: "bg-warn-soft text-warn border-warn-border",
  overdue: "bg-warn-soft text-warn border-warn-border",
  paid: "bg-ok-soft text-ok border-line",
  void: "bg-paper-2 text-ink-4 border-line",
};

export const TRUST_TYPE_LABEL: Record<string, string> = {
  deposit: "Deposit",
  disbursement: "Disbursement",
  refund: "Refund",
  transfer: "Transfer",
  interest: "Interest",
};

export function Kpi({
  label,
  primary,
  secondary,
  tone,
}: {
  label: string;
  primary: string;
  secondary: string;
  tone?: "ok" | "brand" | "warn";
}) {
  const toneClass =
    tone === "ok"
      ? "text-ok"
      : tone === "brand"
        ? "text-brand-700"
        : tone === "warn"
          ? "text-warn"
          : "text-ink";
  return (
    <Card>
      <CardContent className="px-4 py-3">
        <div className="text-2xs font-mono uppercase tracking-wider text-ink-4">
          {label}
        </div>
        <div className={`text-xl font-display font-medium mt-1 ${toneClass}`}>
          {primary}
        </div>
        <div className="text-2xs text-ink-4 mt-1">{secondary}</div>
      </CardContent>
    </Card>
  );
}
