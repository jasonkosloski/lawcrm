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
 * What's deferred (intentionally — see docs/MVP_TODO.md):
 *   - Invoice line-item editing beyond the auto-bundle
 *   - Expenses (no Expense model yet)
 *   - Partial payments
 *   - PDF export / email send
 *   - Settlement distribution waterfall
 *   - Tax calculation (taxAmount stays 0)
 *   - Aging report (the row's daysUntilDue gets the user 90% there)
 */

import Link from "next/link";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
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
import { GenerateInvoiceForm } from "@/components/matters/billing/generate-invoice-form";
import { InvoiceRowActions } from "@/components/matters/billing/invoice-row-actions";
import { InvoicePreview } from "@/components/matters/billing/invoice-preview";
import { TrustTransactionForm } from "@/components/matters/billing/trust-transaction-form";
import {
  getMatterBilling,
  getInvoiceById,
  type MatterBilling,
} from "@/lib/queries/billing";
import { getCurrentFirm } from "@/lib/firm";
import { INVOICE_STATUS_LABEL } from "@/lib/billing-form";

const formatMoney = (n: number): string =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDate = (d: Date): string =>
  d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const STATUS_META: Record<string, string> = {
  draft: "bg-paper-2 text-ink-3 border-line",
  sent: "bg-brand-soft text-brand-700 border-brand-200",
  open: "bg-brand-soft text-brand-700 border-brand-200",
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

  const [billing, firm] = await Promise.all([
    getMatterBilling(id),
    getCurrentFirm(),
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
      selectedInvoiceId={selectedInvoiceId}
      isSplit={!!selectedInvoice}
    />
  );

  // Single-column when nothing's selected. Two-column the moment
  // an invoice is selected — the main column compresses, the
  // preview pane lives on the right. The right pane is `sticky` so
  // it stays in view as the user scrolls WIP / Trust on the left.
  if (!selectedInvoice) {
    return <div className="p-5 flex flex-col gap-5">{main}</div>;
  }

  return (
    <div className="p-5 flex gap-5 items-start">
      <div className="flex-1 min-w-0 flex flex-col gap-5">{main}</div>
      <aside className="w-[36rem] shrink-0 sticky top-5 max-h-[calc(100vh-2.5rem)] flex flex-col rounded-md border border-line overflow-hidden bg-paper">
        <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-line bg-paper-2/60 shrink-0">
          <div className="text-2xs font-mono uppercase tracking-wider text-ink-4">
            Invoice {selectedInvoice.invoiceNumber}
          </div>
          <Link
            href={`/matters/${id}/billing`}
            scroll={false}
            aria-label="Close preview"
            title="Close preview"
            className="inline-flex items-center justify-center w-6 h-6 rounded-md text-ink-4 hover:bg-paper-2 hover:text-ink"
          >
            <X size={14} />
          </Link>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          <InvoicePreview invoice={selectedInvoice} firm={firm} />
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
  selectedInvoiceId,
  isSplit,
}: {
  matterId: string;
  billing: MatterBilling;
  selectedInvoiceId: string | null;
  isSplit: boolean;
}) {
  const openInvoiceCount = billing.invoices.filter(
    (i) => i.status !== "paid" && i.status !== "void"
  ).length;

  const invoiceHref = (invId: string): string =>
    `/matters/${matterId}/billing?invoice=${invId}`;

  return (
    <>
      {/* ── Top KPI strip ───────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
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
                  <TableHead className="pr-4 w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {billing.invoices.map((inv) => {
                  const isSelected = inv.id === selectedInvoiceId;
                  // Each cell wraps its content in a Link so the whole
                  // row is clickable; the kebab is its own link-free
                  // cell so it doesn't double-fire navigation.
                  const cellLink = (children: React.ReactNode) => (
                    <Link
                      href={invoiceHref(inv.id)}
                      scroll={false}
                      className="block py-3"
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
                      <TableCell className="pl-4 font-mono text-xs p-0">
                        <Link
                          href={invoiceHref(inv.id)}
                          scroll={false}
                          className={cn(
                            "block py-3",
                            isSelected
                              ? "text-brand-700 font-semibold"
                              : "text-ink"
                          )}
                        >
                          {inv.invoiceNumber}
                          {inv.lineItemCount > 0 && (
                            <span className="ml-2 text-2xs text-ink-4 font-sans">
                              · {inv.lineItemCount}{" "}
                              {inv.lineItemCount === 1 ? "item" : "items"}
                            </span>
                          )}
                        </Link>
                      </TableCell>
                      <TableCell className="p-0">
                        {cellLink(
                          <span
                            className={`inline-block text-2xs font-medium px-2 py-0.5 rounded-full border ${STATUS_META[inv.status] ?? STATUS_META.draft}`}
                          >
                            {INVOICE_STATUS_LABEL[inv.status] ?? inv.status}
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
                      <TableCell className="pr-4 text-right">
                        <InvoiceRowActions
                          invoiceId={inv.id}
                          invoiceNumber={inv.invoiceNumber}
                          currentStatus={inv.status}
                        />
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
          <GenerateInvoiceForm
            matterId={matterId}
            amountTotal={billing.wip.amountTotal}
            entryCount={billing.wip.entryCount}
          />
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
                        {t.description}
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
    </>
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
