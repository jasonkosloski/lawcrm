/** The Billing tab's main column — rendered once inside either the
 *  single-column or split (invoice preview) layout. */

import Link from "next/link";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  BILLING_MODE_DESCRIPTION,
  BILLING_MODE_LABEL,
  type BillingMode,
} from "@/lib/billing-mode-constants";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BundleInternalRecordForm } from "@/components/matters/billing/bundle-internal-record-form";
import { GenerateInvoiceForm } from "@/components/matters/billing/generate-invoice-form";
import { type MatterBilling } from "@/lib/queries/billing";
import { type UnbilledExpenseSummary } from "@/lib/queries/billing-expenses";
import { type MatterSettlement } from "@/lib/queries/settlements";
import { bundleTotal } from "@/components/matters/billing/bundle-summary";
import { StatStrip } from "@/components/shared/stat-strip";
import { formatMoney } from "@/lib/format-money";
import { formatDay, type BillingPermissions } from "./shared";
import { InvoicesCard } from "./invoices-card";
import { ReceivedPaymentsCard, TrustLedgerCard } from "./ledger-cards";
import { SettlementCard } from "./settlement-card";

/** All the page's main content — extracted so we can render it once
 *  inside either the single-column or split layout. */
export function MainColumn({
  matterId,
  billing,
  unbilledExpenses,
  permissions,
  portalBillingEnabled,
  timeZone,
  settlement,
  canViewSettlement,
  canEditSettlement,
  canManageLiens,
  canApproveSettlement,
  selectedInvoiceId,
  isSplit,
}: {
  matterId: string;
  billing: MatterBilling;
  /** Billable, un-invoiced expenses — the generate / bundle actions
   *  sweep these along with the time in `billing.wip`. */
  unbilledExpenses: UnbilledExpenseSummary;
  permissions: BillingPermissions;
  /** Billing is visible to the client in the portal. */
  portalBillingEnabled: boolean;
  /** Viewer's profile zone, for the invoice issue / due instants. */
  timeZone: string;
  settlement: MatterSettlement | null;
  canViewSettlement: boolean;
  canEditSettlement: boolean;
  canManageLiens: boolean;
  canApproveSettlement: boolean;
  selectedInvoiceId: string | null;
  isSplit: boolean;
}) {
  // Same definition as Outstanding AR: billed client invoices that
  // still owe money (drafts / approved haven't reached the client;
  // internal records have no AR).
  const openInvoiceCount = billing.invoices.filter(
    (i) => i.kind === "client" && (i.status === "sent" || i.status === "partial")
  ).length;

  const invoiceHref = (invId: string): string =>
    `/matters/${matterId}/billing?invoice=${invId}`;

  const billingMode = billing.billingMode as BillingMode;
  const isTraditional = billingMode === "client";

  // WIP = unbilled time + unbilled billable expenses: the invoice
  // actions bundle both, so the KPI and card must count both.
  const wipTotal = bundleTotal(
    billing.wip.amountTotal,
    unbilledExpenses.total
  );
  const wipItemCount = billing.wip.entryCount + unbilledExpenses.count;
  const wipSecondary = [
    `${billing.wip.hoursTotal.toFixed(1)} h · ${billing.wip.entryCount} ${billing.wip.entryCount === 1 ? "entry" : "entries"}`,
    unbilledExpenses.count > 0
      ? `${unbilledExpenses.count} ${unbilledExpenses.count === 1 ? "expense" : "expenses"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      {/* ── Mode chip + (when non-client) info banner ──────── */}
      <div className="flex items-center gap-2 -mb-2">
        <span
          className={cn(
            "inline-flex items-center text-2xs font-medium px-2 py-0.5 rounded-full border",
            isTraditional
              ? "bg-paper-2 text-ink-3 border-line"
              : "bg-brand-soft text-brand-700 border-brand-200"
          )}
          title={BILLING_MODE_DESCRIPTION[billingMode]}
        >
          {BILLING_MODE_LABEL[billingMode]}
        </span>
        <span className="text-2xs text-ink-4">
          ·{" "}
          <Link
            href={`/matters/${matterId}/edit`}
            className="hover:text-brand-700 hover:underline"
          >
            change on matter edit
          </Link>
        </span>
      </div>
      {!isTraditional && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md border border-warn-border bg-warn-soft text-2xs text-warn">
          <Info size={12} className="shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">
              {BILLING_MODE_LABEL[billingMode]} flow isn&apos;t implemented yet.
            </div>
            <div className="text-ink-3 mt-0.5">
              {BILLING_MODE_DESCRIPTION[billingMode]} For now this matter
              uses the traditional client-billing UX below — generated
              invoices won&apos;t carry the mode-specific letterhead or
              workflow until that lands.
            </div>
          </div>
        </div>
      )}

      {/* ── Top KPI strip — stacks on phones, side-by-side from sm+. ─── */}
      <StatStrip
        stats={[
          {
            label: "Work-in-progress",
            value: formatMoney(wipTotal),
            detail: wipSecondary,
          },
          {
            label: "Trust balance",
            value: formatMoney(billing.trust.balance),
            detail: `${billing.trust.transactions.length} recent ${billing.trust.transactions.length === 1 ? "txn" : "txns"}`,
            tone: billing.trust.balance < 0 ? "danger" : undefined,
          },
          {
            label: "Outstanding AR",
            value: formatMoney(billing.outstandingAr),
            detail: `${openInvoiceCount} open ${openInvoiceCount === 1 ? "invoice" : "invoices"}`,
          },
        ]}
      />

      <InvoicesCard
        billing={billing}
        isSplit={isSplit}
        selectedInvoiceId={selectedInvoiceId}
        timeZone={timeZone}
        invoiceHref={invoiceHref}
      />

      {/* ── WIP detail + generate CTA ──────────────────────── */}
      <Card className="p-0 overflow-hidden">
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            Work-in-progress
            <span className="text-2xs font-mono font-normal text-ink-4">
              {wipItemCount}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 flex flex-col gap-3">
          {/* Two ways to clear WIP. The primary action bills the
              client; the secondary closes WIP without billing —
              for contingency settlements, abandoned matters, or
              fee-already-collected-elsewhere cases. Both share
              the same bundle-and-link mechanic, so void on either
              kind unlinks entries back to billable WIP. */}
          {permissions.generateInvoice ? (
            <div className="flex flex-wrap items-center gap-2">
              <GenerateInvoiceForm
                matterId={matterId}
                amountTotal={billing.wip.amountTotal}
                entryCount={billing.wip.entryCount}
                expenseTotal={unbilledExpenses.total}
                expenseCount={unbilledExpenses.count}
              />
              <BundleInternalRecordForm
                matterId={matterId}
                amountTotal={billing.wip.amountTotal}
                entryCount={billing.wip.entryCount}
                expenseTotal={unbilledExpenses.total}
                expenseCount={unbilledExpenses.count}
              />
            </div>
          ) : (
            wipItemCount > 0 && (
              <div className="text-2xs text-ink-4 italic">
                Generating an invoice from this work-in-progress needs the
                billing.generate_invoice permission.
              </div>
            )
          )}
          {billing.wip.recent.length > 0 && (
            <div className="border border-line rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Date</TableHead>
                    <TableHead>Activity</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead>Hrs</TableHead>
                    <TableHead className="pr-4">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {billing.wip.recent.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="pl-4 text-2xs font-mono text-ink-3">
                        {formatDay(e.date)}
                      </TableCell>
                      <TableCell className="text-xs text-ink truncate max-w-md">
                        {e.activity}
                      </TableCell>
                      <TableCell className="text-2xs font-mono text-ink-3">
                        {e.userInitials}
                      </TableCell>
                      <TableCell className="text-2xs font-mono text-ink-3">
                        {e.hours.toFixed(2)}
                      </TableCell>
                      <TableCell className="pr-4 text-xs font-mono text-ink">
                        {e.amount !== null ? formatMoney(e.amount) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {billing.wip.entryCount > billing.wip.recent.length && (
                <div className="px-4 py-2 text-2xs text-ink-4 border-t border-line bg-paper-2/50">
                  Showing {billing.wip.recent.length} of{" "}
                  {billing.wip.entryCount} unbilled entries — generating the
                  invoice bundles all of them.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Received payments ledger ───────────────────────── */}
      {/* Matter-level view of every payment ever applied to any
          invoice on this matter, regardless of channel. Distinct
          from the Trust ledger above (which only reflects trust-
          account movement); this surfaces check / ACH / cash / card
          payments that don't touch trust at all, and also includes
          the trust-funded payments so the firm has one place to
          see "money in" per matter. Long-term this becomes a slice
          of a firm-wide operating-account ledger. */}
      <ReceivedPaymentsCard billing={billing} invoiceHref={invoiceHref} />

      {/* ── Trust ledger ───────────────────────────────────── */}
      <TrustLedgerCard
        matterId={matterId}
        billing={billing}
        permissions={permissions}
        portalBillingEnabled={portalBillingEnabled}
        invoiceHref={invoiceHref}
      />

      {/* ── Settlement waterfall ───────────────────────────── */}
      {/* matters.settlement.view gates the whole card — without it
          the user gets no hint a settlement exists, even if they
          hold edit/approve keys (view is the floor; see
          docs/PERMISSIONS.md). Within the card, edit/manage_liens/
          approve gate their own affordances. */}
      {canViewSettlement && (settlement || canEditSettlement) && (
        <SettlementCard
          matterId={matterId}
          settlement={settlement}
          canEdit={canEditSettlement}
          canManageLiens={canManageLiens}
          canApprove={canApproveSettlement}
        />
      )}
    </>
  );
}
