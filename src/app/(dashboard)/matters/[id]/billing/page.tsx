/**
 * Matter Detail — Billing tab (v1)
 *
 * Layout:
 *   - **No invoice selected (default):** the page reads top-to-
 *     bottom in a single column — KPI strip, full-width invoices
 *     table, WIP, Trust ledger.
 *   - **Invoice selected (?invoice=<id>):** the entire main column
 *     compresses to a left lane and a sticky preview pane appears
 *     on the right with the letterhead view + action bar. Scrolling
 *     the page moves the left lane while the preview stays put.
 *     Closing the preview (× button or clearing the URL) restores
 *     the full-width single-column layout.
 *
 * The single-column ↔ split toggle reads `?invoice=<id>` so the
 * view is deep-linkable + back-button-honest, matching the email
 * + calendar URL patterns.
 *
 * What's deferred (intentionally — see docs/FEATURES.md):
 *   - Invoice line-item editing beyond the auto-bundle
 *   - Expenses (no Expense model yet)
 *   - Partial payments
 *   - PDF export / email send
 *   - Settlement distribution waterfall
 *   - Tax calculation (taxAmount stays 0)
 *   - Aging report (the row's daysUntilDue gets the user 90% there)
 */

import Link from "next/link";
import { Info, Printer, X } from "lucide-react";
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
import { InvoiceActionBar } from "@/components/matters/billing/invoice-action-bar";
import { InvoicePreview } from "@/components/matters/billing/invoice-preview";
import { TrustTransactionForm } from "@/components/matters/billing/trust-transaction-form";
import { SettlementApprovals } from "@/components/matters/settlement/settlement-approvals";
import { SettlementComposer } from "@/components/matters/settlement/settlement-composer";
import { SettlementLienForm } from "@/components/matters/settlement/settlement-lien-form";
import {
  getMatterBilling,
  getInvoiceById,
  type MatterBilling,
} from "@/lib/queries/billing";
import {
  getMatterSettlement,
  type MatterSettlement,
} from "@/lib/queries/settlements";
import { getCurrentFirm } from "@/lib/firm";
import { getCurrentUserId } from "@/lib/current-user";
import { currentUserHasPermission } from "@/lib/permission-check";
import {
  invoiceStatusLabel,
  INVOICE_PAYMENT_SOURCE_LABEL,
  type InvoiceKind,
  type InvoicePaymentSource,
} from "@/lib/billing-form";
import { formatDate as formatDateVariant } from "@/lib/format-date";

const formatMoney = (n: number): string =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Billing dates on this page are a mix of date-only values (expense /
// payment / trust-transaction dates, stored at server-local midnight)
// and instants (invoice issue/due, minted with `new Date()`). Both
// funnel through the centralized "medium" variant on the server-local
// grid — the day the value was saved on. Threading the viewer's TZ
// for the instant flavor is deferred until the two storage shapes
// are split apart.
const formatDate = (d: Date): string => formatDateVariant(d, "medium");

const STATUS_META: Record<string, string> = {
  draft: "bg-paper-2 text-ink-3 border-line",
  approved: "bg-brand-soft/60 text-brand-700 border-brand-200",
  sent: "bg-brand-soft text-brand-700 border-brand-200",
  partial: "bg-warn-soft text-warn border-warn-border",
  overdue: "bg-warn-soft text-warn border-warn-border",
  paid: "bg-ok-soft text-ok border-line",
  void: "bg-paper-2 text-ink-4 border-line",
};

const TRUST_TYPE_LABEL: Record<string, string> = {
  deposit: "Deposit",
  disbursement: "Disbursement",
  refund: "Refund",
  transfer: "Transfer",
  interest: "Interest",
};

export default async function MatterBillingPage({
  params,
  searchParams,
}: PageProps<"/matters/[id]/billing">) {
  const { id } = await params;
  const sp = await searchParams;
  const rawInvoice = Array.isArray(sp.invoice) ? sp.invoice[0] : sp.invoice;
  const requestedInvoiceId =
    typeof rawInvoice === "string" ? rawInvoice : null;

  const [
    billing,
    firm,
    settlement,
    canViewSettlement,
    canEditSettlement,
    canManageLiens,
    canApproveSettlement,
    canEditAnyTimeEntry,
    currentUserId,
  ] = await Promise.all([
    getMatterBilling(id),
    getCurrentFirm(),
    getMatterSettlement(id),
    // Gates the entire Settlement card — the waterfall (gross,
    // firm fee, liens, client net) is the most sensitive number
    // set on the matter, so billing-tab access alone isn't enough
    // to see it.
    currentUserHasPermission("matters.settlement.view"),
    currentUserHasPermission("matters.settlement.edit"),
    currentUserHasPermission("matters.settlement.manage_liens"),
    currentUserHasPermission("matters.settlement.approve"),
    // Drives the line-item edit pencil on draft/approved
    // invoices for non-author actors. Authors of an entry can
    // always edit their own (per-row check below) — this gates
    // the cross-author path.
    currentUserHasPermission("time_entries.edit_any"),
    getCurrentUserId(),
  ]);

  // Validate the requested invoice belongs to this matter — defends
  // against a stale ?invoice= surviving navigation between matters
  // (and against URL-tampering once we go multi-tenant).
  const selectedInvoiceId =
    requestedInvoiceId &&
    billing.invoices.some((i) => i.id === requestedInvoiceId)
      ? requestedInvoiceId
      : null;
  const selectedInvoice = selectedInvoiceId
    ? await getInvoiceById(selectedInvoiceId)
    : null;

  const main = (
    <MainColumn
      matterId={id}
      billing={billing}
      settlement={settlement}
      canViewSettlement={canViewSettlement}
      canEditSettlement={canEditSettlement}
      canManageLiens={canManageLiens}
      canApproveSettlement={canApproveSettlement}
      selectedInvoiceId={selectedInvoiceId}
      isSplit={!!selectedInvoice}
    />
  );

  // Single-column when nothing's selected. Two-column the moment
  // an invoice is selected — the main column compresses, the
  // preview pane lives on the right. The right pane is `sticky` so
  // it stays in view as the user scrolls WIP / Trust on the left.
  if (!selectedInvoice) {
    return <div className="p-3 sm:p-5 flex flex-col gap-5">{main}</div>;
  }

  return (
    <div className="p-3 sm:p-5 flex flex-col xl:flex-row gap-5 xl:items-start">
      <div className="flex-1 min-w-0 flex flex-col gap-5">{main}</div>
      {/* Preview pane is full-width on smaller screens (stacks
          below the main column), 36rem wide and sticky on xl+
          where the viewport has the room. Caps out at the
          viewport height so the doc body still scrolls. */}
      <aside className="w-full xl:w-[36rem] xl:shrink-0 xl:sticky xl:top-5 xl:max-h-[calc(100vh-2.5rem)] flex flex-col rounded-md border border-line overflow-hidden bg-paper">
        {/* Sticky top bar — stays visible as the document body
            below scrolls. Hosts the invoice label + status-aware
            action buttons + close. The body section is the scroll
            container, so this header naturally sits put. */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-line bg-paper-2/60 shrink-0">
          <div className="text-2xs font-mono uppercase tracking-wider text-ink-4 mr-auto pl-1">
            Invoice {selectedInvoice.invoiceNumber}
          </div>
          <InvoiceActionBar
            invoiceId={selectedInvoice.id}
            invoiceNumber={selectedInvoice.invoiceNumber}
            currentStatus={selectedInvoice.status}
            kind={selectedInvoice.kind as InvoiceKind}
            invoiceBalance={selectedInvoice.balance}
            trustBalance={billing.trust.balance}
            paidAmount={selectedInvoice.paidAmount}
            clientEmail={selectedInvoice.clientEmail}
          />
          {/* Print / Save as PDF — opens the print route in a new
              tab with auto-print enabled so the browser dialog
              fires immediately. New tab so the matter page stays
              put behind the print preview. */}
          <a
            href={`/print/invoices/${selectedInvoice.id}?autoprint=1`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Print or save as PDF"
            title="Print or save as PDF"
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-4 hover:bg-paper-2 hover:text-ink"
          >
            <Printer size={14} />
          </a>
          <Link
            href={`/matters/${id}/billing`}
            scroll={false}
            aria-label="Close preview"
            title="Close preview"
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-4 hover:bg-paper-2 hover:text-ink"
          >
            <X size={14} />
          </Link>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          <InvoicePreview
            invoice={selectedInvoice}
            firm={firm}
            // Line items are editable while the invoice is still
            // in the firm's possession — `draft` or `approved`.
            // Once `sent`, edits would diverge from the doc the
            // client received.
            editable={
              selectedInvoice.status === "draft" ||
              selectedInvoice.status === "approved"
            }
            currentUserId={currentUserId}
            canEditAnyTimeEntry={canEditAnyTimeEntry}
          />
        </div>
      </aside>
    </div>
  );
}

/** All the page's main content — extracted so we can render it once
 *  inside either the single-column or split layout. */
function MainColumn({
  matterId,
  billing,
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
  settlement: MatterSettlement | null;
  canViewSettlement: boolean;
  canEditSettlement: boolean;
  canManageLiens: boolean;
  canApproveSettlement: boolean;
  selectedInvoiceId: string | null;
  isSplit: boolean;
}) {
  const openInvoiceCount = billing.invoices.filter(
    (i) => i.status !== "paid" && i.status !== "void"
  ).length;

  const invoiceHref = (invId: string): string =>
    `/matters/${matterId}/billing?invoice=${invId}`;

  const billingMode = billing.billingMode as BillingMode;
  const isTraditional = billingMode === "client";

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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Kpi
          label="Work-in-progress"
          primary={formatMoney(billing.wip.amountTotal)}
          secondary={`${billing.wip.hoursTotal.toFixed(1)} h · ${billing.wip.entryCount} ${billing.wip.entryCount === 1 ? "entry" : "entries"}`}
        />
        <Kpi
          label="Trust balance"
          primary={formatMoney(billing.trust.balance)}
          secondary={`${billing.trust.transactions.length} recent ${billing.trust.transactions.length === 1 ? "txn" : "txns"}`}
          tone={billing.trust.balance > 0 ? "ok" : undefined}
        />
        <Kpi
          label="Outstanding AR"
          primary={formatMoney(billing.outstandingAr)}
          secondary={`${openInvoiceCount} open ${openInvoiceCount === 1 ? "invoice" : "invoices"}`}
          tone={billing.outstandingAr > 0 ? "brand" : undefined}
        />
      </div>

      {/* ── Invoices ───────────────────────────────────────── */}
      <Card className="p-0 overflow-hidden">
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            Invoices
            <span className="text-2xs font-mono font-normal text-ink-4">
              {billing.invoices.length}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {billing.invoices.length === 0 ? (
            <div className="p-6 text-center">
              <div className="text-xs text-ink-3 mb-1">No invoices yet.</div>
              <div className="text-2xs text-ink-4">
                Generate the first one from WIP below.
              </div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">#</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Total</TableHead>
                  {/* Hide Paid in split mode — the preview shows it. */}
                  {!isSplit && <TableHead>Paid</TableHead>}
                  <TableHead>Balance</TableHead>
                  <TableHead className="pr-4 w-9 sr-only">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {billing.invoices.map((inv) => {
                  const isSelected = inv.id === selectedInvoiceId;
                  // Each cell wraps its content in a Link that fills
                  // the cell so the whole row is clickable. The kebab
                  // cell stays link-free so its menu doesn't double-
                  // fire navigation. Padding lives on the Link (not
                  // the TableCell) because TableCell's default p-2
                  // would otherwise eat half the click target — the
                  // first/last cells get extra px-4 for the table's
                  // outer gutter.
                  const cellLink = (
                    children: React.ReactNode,
                    extraClasses?: string
                  ) => (
                    <Link
                      href={invoiceHref(inv.id)}
                      scroll={false}
                      className={cn("block px-2 py-3", extraClasses)}
                    >
                      {children}
                    </Link>
                  );
                  return (
                    <TableRow
                      key={inv.id}
                      className={cn(
                        "cursor-pointer transition-colors",
                        isSelected
                          ? "bg-brand-tint hover:bg-brand-tint"
                          : "hover:bg-paper-2"
                      )}
                    >
                      <TableCell className="font-mono text-xs p-0">
                        {cellLink(
                          <>
                            {inv.invoiceNumber}
                            {inv.kind === "internal_record" && (
                              <span
                                className="ml-2 text-2xs text-ink-3 px-1.5 py-px rounded-full border border-line bg-paper-2 font-sans"
                                title="Internal record — closes WIP without billing the client. Excluded from Outstanding AR."
                              >
                                internal
                              </span>
                            )}
                            {inv.lineItemCount > 0 && (
                              <span className="ml-2 text-2xs text-ink-4 font-sans">
                                · {inv.lineItemCount}{" "}
                                {inv.lineItemCount === 1 ? "item" : "items"}
                              </span>
                            )}
                          </>,
                          cn(
                            "pl-4",
                            isSelected
                              ? "text-brand-700 font-semibold"
                              : "text-ink"
                          )
                        )}
                      </TableCell>
                      <TableCell className="p-0">
                        {cellLink(
                          <span className="inline-flex items-center gap-1 flex-wrap">
                            <span
                              className={`inline-block text-2xs font-medium px-2 py-0.5 rounded-full border ${STATUS_META[inv.status] ?? STATUS_META.draft}`}
                            >
                              {invoiceStatusLabel(
                                inv.status,
                                inv.kind as InvoiceKind
                              )}
                            </span>
                            {/* Drift indicator: an old row that
                                pre-dates the "partial" status sits in
                                'sent' but already has payment against
                                it. New rows go straight to status=
                                'partial' and don't need the chip. */}
                            {inv.kind === "client" &&
                              inv.status === "sent" &&
                              inv.paidAmount > 0 &&
                              inv.paidAmount < inv.totalAmount && (
                                <span
                                  className="text-2xs font-medium px-1.5 py-0.5 rounded-full border bg-paper-2 text-ink-3 border-line"
                                  title="Some payment recorded but a balance remains."
                                >
                                  partial
                                </span>
                              )}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-2xs font-mono text-ink-3 p-0">
                        {cellLink(formatDate(inv.issueDate))}
                      </TableCell>
                      <TableCell className="text-2xs font-mono p-0">
                        {cellLink(
                          <span
                            className={
                              inv.daysUntilDue !== null &&
                              inv.daysUntilDue < 0
                                ? "text-warn font-medium"
                                : "text-ink-3"
                            }
                          >
                            {formatDate(inv.dueDate)}
                            {inv.daysUntilDue !== null &&
                              inv.daysUntilDue < 0 && (
                                <span className="ml-1 text-warn">
                                  ({Math.abs(inv.daysUntilDue)}d late)
                                </span>
                              )}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs font-mono text-ink p-0">
                        {cellLink(formatMoney(inv.totalAmount))}
                      </TableCell>
                      {!isSplit && (
                        <TableCell className="text-xs font-mono text-ink-3 p-0">
                          {cellLink(formatMoney(inv.paidAmount))}
                        </TableCell>
                      )}
                      <TableCell className="text-xs font-mono font-medium p-0">
                        {cellLink(
                          <span
                            className={
                              inv.balance > 0 ? "text-ink" : "text-ink-4"
                            }
                          >
                            {formatMoney(inv.balance)}
                          </span>
                        )}
                      </TableCell>
                      {/* Print column — sits outside the row's
                          full-cell Link so clicking the icon goes
                          to the print route in a new tab without
                          first opening the preview pane. */}
                      <TableCell className="p-0 pr-4 w-9 align-middle">
                        <a
                          href={`/print/invoices/${inv.id}?autoprint=1`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Print invoice ${inv.invoiceNumber} or save as PDF`}
                          title="Print or save as PDF"
                          className="inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-4 hover:bg-paper-3 hover:text-ink"
                        >
                          <Printer size={13} />
                        </a>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── WIP detail + generate CTA ──────────────────────── */}
      <Card className="p-0 overflow-hidden">
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            Work-in-progress
            <span className="text-2xs font-mono font-normal text-ink-4">
              {billing.wip.entryCount}
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
          <div className="flex flex-wrap items-center gap-2">
            <GenerateInvoiceForm
              matterId={matterId}
              amountTotal={billing.wip.amountTotal}
              entryCount={billing.wip.entryCount}
            />
            <BundleInternalRecordForm
              matterId={matterId}
              amountTotal={billing.wip.amountTotal}
              entryCount={billing.wip.entryCount}
            />
          </div>
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
                        {formatDate(e.date)}
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
      <Card className="p-0 overflow-hidden">
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            Received payments
            <span className="text-2xs font-mono font-normal text-ink-4">
              total {formatMoney(billing.receivedPayments.totalReceived)}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 flex flex-col gap-3">
          {billing.receivedPayments.rows.length === 0 ? (
            <div className="text-2xs text-ink-4 italic">
              No payments received on this matter yet. Use{" "}
              <span className="font-medium">Record payment</span> from an
              open invoice to log one.
            </div>
          ) : (
            <div className="border border-line rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Date</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead className="pr-4">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {billing.receivedPayments.rows.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="pl-4 text-2xs font-mono text-ink-3">
                        {formatDate(p.date)}
                      </TableCell>
                      <TableCell className="text-2xs text-ink-3">
                        {INVOICE_PAYMENT_SOURCE_LABEL[
                          p.source as InvoicePaymentSource
                        ] ?? p.source}
                        {p.description && (
                          <div className="text-2xs text-ink-4 mt-0.5 truncate max-w-xs">
                            {p.description}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        <Link
                          href={invoiceHref(p.invoiceId)}
                          scroll={false}
                          className="text-ink hover:text-brand-700 hover:underline font-mono"
                        >
                          {p.invoiceNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="text-2xs font-mono text-ink-4">
                        {p.reference ?? "—"}
                      </TableCell>
                      <TableCell className="pr-4 text-xs font-mono text-ok">
                        +{formatMoney(p.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Trust ledger ───────────────────────────────────── */}
      <Card className="p-0 overflow-hidden">
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            Trust ledger (IOLTA)
            <span className="text-2xs font-mono font-normal text-ink-4">
              balance {formatMoney(billing.trust.balance)}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 flex flex-col gap-3">
          <TrustTransactionForm matterId={matterId} />
          {billing.trust.transactions.length === 0 ? (
            <div className="text-2xs text-ink-4 italic">
              No trust activity yet on this matter.
            </div>
          ) : (
            <div className="border border-line rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead className="pr-4">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {billing.trust.transactions.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="pl-4 text-2xs font-mono text-ink-3">
                        {formatDate(t.date)}
                      </TableCell>
                      <TableCell className="text-2xs text-ink-3 capitalize">
                        {TRUST_TYPE_LABEL[t.type] ?? t.type}
                      </TableCell>
                      <TableCell className="text-xs text-ink truncate max-w-md">
                        {t.invoiceId && t.invoiceNumber ? (
                          <Link
                            href={invoiceHref(t.invoiceId)}
                            scroll={false}
                            className="hover:text-brand-700 hover:underline"
                          >
                            {t.description}
                          </Link>
                        ) : (
                          t.description
                        )}
                      </TableCell>
                      <TableCell className="text-2xs font-mono text-ink-4">
                        {t.reference ?? "—"}
                      </TableCell>
                      <TableCell
                        className={`pr-4 text-xs font-mono ${
                          t.amount >= 0 ? "text-ok" : "text-warn"
                        }`}
                      >
                        {t.amount >= 0 ? "+" : ""}
                        {formatMoney(t.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

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

function SettlementCard({
  matterId,
  settlement,
  canEdit,
  canManageLiens,
  canApprove,
}: {
  matterId: string;
  settlement: MatterSettlement | null;
  canEdit: boolean;
  canManageLiens: boolean;
  canApprove: boolean;
}) {
  return (
    <Card className="p-0 overflow-hidden">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          Settlement
          {settlement && (
            <span
              className={cn(
                "text-2xs font-medium px-2 py-0.5 rounded-full border",
                settlement.status === "disbursed" || settlement.status === "closed"
                  ? "bg-ok-soft text-ok border-line"
                  : settlement.status === "approved"
                    ? "bg-brand-soft text-brand-700 border-brand-200"
                    : "bg-paper-2 text-ink-3 border-line"
              )}
            >
              {settlement.status}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 flex flex-col gap-3">
        {!settlement ? (
          <>
            <div className="text-2xs text-ink-4 leading-relaxed">
              No settlement opened on this matter yet. Contingency
              matters use this section to capture the gross
              settlement, firm fee, advanced costs, and any liens —
              the client&apos;s net distribution computes
              automatically.
            </div>
            <SettlementComposer
              matterId={matterId}
              initial={null}
              canEdit={canEdit}
            />
          </>
        ) : (
          <>
            {/* Waterfall: gross → firm fee → advanced costs →
                liens → client net. Each row is a flow stage so the
                lawyer can scan it the way they'd narrate it to a
                client. */}
            <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-xs">
              <dt className="text-ink-2 font-medium">Gross settlement</dt>
              <dd className="font-mono text-ink">
                {formatMoney(settlement.grossAmount)}
              </dd>

              <dt className="text-ink-3 pl-3">
                Firm fee
                {settlement.firmFeePercent !== null && (
                  <span className="text-ink-4 ml-1">
                    ({settlement.firmFeePercent}%)
                  </span>
                )}
              </dt>
              <dd className="font-mono text-warn">
                −{formatMoney(settlement.firmFee)}
              </dd>

              {settlement.advancedCosts > 0 && (
                <>
                  <dt className="text-ink-3 pl-3">Advanced costs</dt>
                  <dd className="font-mono text-warn">
                    −{formatMoney(settlement.advancedCosts)}
                  </dd>
                </>
              )}

              {settlement.lienTotal > 0 && (
                <>
                  <dt className="text-ink-3 pl-3">
                    Liens
                    <span className="text-ink-4 ml-1">
                      ({settlement.liens.length})
                    </span>
                  </dt>
                  <dd className="font-mono text-warn">
                    −{formatMoney(settlement.lienTotal)}
                  </dd>
                </>
              )}

              <dt className="text-ink font-semibold pt-1.5 border-t border-line mt-1">
                Client net
              </dt>
              <dd className="font-mono font-semibold text-ok pt-1.5 border-t border-line mt-1">
                {formatMoney(settlement.clientNet)}
              </dd>
            </dl>

            {/* Liens list (read-only chips by default; the form
                below adds new ones when the user has the
                permission). */}
            {settlement.liens.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <div className="text-2xs font-mono uppercase tracking-wider text-ink-4">
                  Liens
                </div>
                <ul className="border border-line rounded-md overflow-hidden divide-y divide-line">
                  {settlement.liens.map((l) => (
                    <li
                      key={l.id}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-2xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-ink truncate">
                          {l.lienholder}
                        </div>
                        <div className="text-ink-4 mt-0.5">
                          {l.lienholderType ?? "—"} · {l.status}
                        </div>
                      </div>
                      <div className="text-right font-mono">
                        <div className="text-ink">
                          {formatMoney(l.effectiveAmount)}
                        </div>
                        {l.negotiatedAmount !== null &&
                          l.negotiatedAmount < l.originalAmount && (
                            <div className="text-2xs text-ink-4 line-through">
                              {formatMoney(l.originalAmount)}
                            </div>
                          )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {canManageLiens && (
              <SettlementLienForm settlementId={settlement.id} />
            )}

            {/* Approval steps. Always rendered when present (read
                view for everyone with view perm); the buttons only
                show for users holding matters.settlement.approve. */}
            {settlement.approvals.length > 0 && (
              <SettlementApprovals
                approvals={settlement.approvals.map((a) => ({
                  id: a.id,
                  step: a.step,
                  label: a.label,
                  status: a.status,
                  approverName: a.approverName,
                  approvedAt: a.approvedAt,
                  notes: a.notes,
                }))}
                canApprove={canApprove}
                settlementLocked={
                  settlement.status === "disbursed" ||
                  settlement.status === "closed"
                }
              />
            )}

            {canEdit && (
              <SettlementComposer
                matterId={matterId}
                initial={{
                  grossAmount: settlement.grossAmount,
                  firmFeePercent: settlement.firmFeePercent,
                  firmFee: settlement.firmFee,
                  advancedCosts: settlement.advancedCosts,
                  status: settlement.status,
                }}
                canEdit={canEdit}
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Kpi({
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
