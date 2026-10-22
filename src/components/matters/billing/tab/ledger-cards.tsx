/** The Billing tab's money-in ledgers: received payments and the
 *  trust (IOLTA) ledger. */

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { TrustTransactionForm } from "@/components/matters/billing/trust-transaction-form";
import { type MatterBilling } from "@/lib/queries/billing";
import { INVOICE_PAYMENT_SOURCE_LABEL, type InvoicePaymentSource } from "@/lib/billing-form";
import { formatMoney } from "@/lib/format-money";

import { formatDay, TRUST_TYPE_LABEL, type BillingPermissions } from "./shared";

export function ReceivedPaymentsCard({
  billing,
  invoiceHref,
}: {
  billing: MatterBilling;
  invoiceHref: (invId: string) => string;
}) {
  return (
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
            <span className="font-medium">Record payment</span> from an open invoice to log one.
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
                      {formatDay(p.date)}
                    </TableCell>
                    <TableCell className="text-2xs text-ink-3">
                      {INVOICE_PAYMENT_SOURCE_LABEL[p.source as InvoicePaymentSource] ?? p.source}
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
  );
}

export function TrustLedgerCard({
  matterId,
  billing,
  permissions,
  portalBillingEnabled,
  invoiceHref,
}: {
  matterId: string;
  billing: MatterBilling;
  permissions: BillingPermissions;
  portalBillingEnabled: boolean;
  invoiceHref: (invId: string) => string;
}) {
  return (
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
        {permissions.recordTrustTransaction && (
          <TrustTransactionForm matterId={matterId} portalBillingEnabled={portalBillingEnabled} />
        )}
        {billing.trust.transactions.length === 0 ? (
          <div className="text-2xs text-ink-4 italic">No trust activity yet on this matter.</div>
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
                      {formatDay(t.date)}
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
  );
}
