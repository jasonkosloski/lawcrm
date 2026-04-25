/**
 * Matter Detail — Billing tab (v1)
 *
 * What's live:
 *   - WIP summary (unbilled billable time) with "Generate invoice"
 *     CTA → bundles every approved+unbilled entry into a draft
 *     Invoice and flips their status to "billed".
 *   - Invoice table with status transitions (draft → sent → paid;
 *     void unlinks entries back to WIP).
 *   - Trust ledger: current balance, transaction history,
 *     manual add (deposit / disbursement / refund) with overdraw
 *     prevention.
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
import { TrustTransactionForm } from "@/components/matters/billing/trust-transaction-form";
import { getMatterBilling } from "@/lib/queries/billing";
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
}: PageProps<"/matters/[id]">) {
  const { id } = await params;
  const billing = await getMatterBilling(id);

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
                  <TableHead>Paid</TableHead>
                  <TableHead>Balance</TableHead>
                  <TableHead className="pr-4 w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {billing.invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="pl-4 font-mono text-xs text-ink">
                      {inv.invoiceNumber}
                      {inv.lineItemCount > 0 && (
                        <span className="ml-2 text-2xs text-ink-4">
                          · {inv.lineItemCount} {inv.lineItemCount === 1 ? "item" : "items"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-block text-2xs font-medium px-2 py-0.5 rounded-full border ${STATUS_META[inv.status] ?? STATUS_META.draft}`}
                      >
                        {INVOICE_STATUS_LABEL[inv.status] ?? inv.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-2xs font-mono text-ink-3">
                      {formatDate(inv.issueDate)}
                    </TableCell>
                    <TableCell className="text-2xs font-mono">
                      <span
                        className={
                          inv.daysUntilDue !== null && inv.daysUntilDue < 0
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
                    </TableCell>
                    <TableCell className="text-xs font-mono text-ink">
                      {formatMoney(inv.totalAmount)}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-ink-3">
                      {formatMoney(inv.paidAmount)}
                    </TableCell>
                    <TableCell
                      className={`text-xs font-mono font-medium ${
                        inv.balance > 0 ? "text-ink" : "text-ink-4"
                      }`}
                    >
                      {formatMoney(inv.balance)}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <InvoiceRowActions
                        invoiceId={inv.id}
                        invoiceNumber={inv.invoiceNumber}
                        currentStatus={inv.status}
                      />
                    </TableCell>
                  </TableRow>
                ))}
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
