/**
 * Matter Detail — Billing tab (v1)
 *
 * Layout:
 *   - Top KPI strip (full width).
 *   - Invoices section: split-pane on desktop. Left = the invoices
 *     table (rows are clickable Links setting `?invoice=<id>`).
 *     Right = letterhead-style preview of the selected invoice, or
 *     a "select an invoice" placeholder when none is set. The
 *     selected row uses ?invoice= URL state so the view is deep-
 *     linkable + back-button-honest (matches the email + calendar
 *     URL patterns).
 *   - WIP and Trust cards (full width below).
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
import { FileText } from "lucide-react";
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
import { InvoicePreview } from "@/components/matters/billing/invoice-preview";
import { TrustTransactionForm } from "@/components/matters/billing/trust-transaction-form";
import { getMatterBilling, getInvoiceById } from "@/lib/queries/billing";
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

  const invoiceHref = (invId: string): string =>
    `/matters/${id}/billing?invoice=${invId}`;

  return (
    <div className="p-5 flex flex-col gap-5">
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
          secondary={`${billing.invoices.filter((i) => i.status !== "paid" && i.status !== "void").length} open ${billing.invoices.filter((i) => i.status !== "paid" && i.status !== "void").length === 1 ? "invoice" : "invoices"}`}
          tone={billing.outstandingAr > 0 ? "brand" : undefined}
        />
      </div>

      {/* ── Invoices: split-pane ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-4">
        {/* Left: list */}
        <Card className="p-0 overflow-hidden self-start">
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
                <div className="text-xs text-ink-3 mb-1">
                  No invoices yet.
                </div>
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
                    <TableHead>Due</TableHead>
                    <TableHead className="pr-4">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {billing.invoices.map((inv) => {
                    const isSelected = inv.id === selectedInvoiceId;
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
                              "block px-0 py-3",
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
                          <Link
                            href={invoiceHref(inv.id)}
                            scroll={false}
                            className="block py-3"
                          >
                            <span
                              className={`inline-block text-2xs font-medium px-2 py-0.5 rounded-full border ${STATUS_META[inv.status] ?? STATUS_META.draft}`}
                            >
                              {INVOICE_STATUS_LABEL[inv.status] ?? inv.status}
                            </span>
                          </Link>
                        </TableCell>
                        <TableCell className="text-2xs font-mono p-0">
                          <Link
                            href={invoiceHref(inv.id)}
                            scroll={false}
                            className="block py-3"
                          >
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
                          </Link>
                        </TableCell>
                        <TableCell className="pr-4 text-xs font-mono font-medium p-0">
                          <Link
                            href={invoiceHref(inv.id)}
                            scroll={false}
                            className={cn(
                              "block py-3",
                              inv.balance > 0 ? "text-ink" : "text-ink-4"
                            )}
                          >
                            {formatMoney(inv.balance)}
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Right: preview pane */}
        <Card className="p-0 overflow-hidden lg:min-h-[36rem] lg:max-h-[calc(100vh-15rem)]">
          {selectedInvoice ? (
            <InvoicePreview invoice={selectedInvoice} firm={firm} />
          ) : (
            <div className="h-full min-h-[20rem] flex flex-col items-center justify-center text-center px-6 py-10 bg-paper-2/30">
              <FileText size={28} className="text-ink-4 mb-2" />
              <div className="text-sm font-medium text-ink mb-1">
                {billing.invoices.length === 0
                  ? "No invoices to preview"
                  : "Select an invoice to preview"}
              </div>
              <div className="text-2xs text-ink-4 max-w-xs">
                {billing.invoices.length === 0
                  ? "Generate one from WIP below — the letterhead preview, line items, and action bar all show up here."
                  : "Click a row on the left to see the letterhead view, line items, and quick actions for that invoice."}
              </div>
            </div>
          )}
        </Card>
      </div>

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
            matterId={id}
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
          <TrustTransactionForm matterId={id} />
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
    </div>
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
