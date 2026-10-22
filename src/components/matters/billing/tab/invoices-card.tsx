/** The Billing tab's Invoices table: one clickable row per invoice. */

import Link from "next/link";
import { Printer } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { type MatterBilling } from "@/lib/queries/billing";
import { invoiceStatusLabel, type InvoiceKind } from "@/lib/billing-form";
import { formatDate } from "@/lib/format-date";
import { formatMoney } from "@/lib/format-money";
import { INVOICE_STATUS_CLASS } from "@/lib/constants/invoice-status";
import { Badge } from "@/components/ui/badge";

export function InvoicesCard({
  billing,
  isSplit,
  selectedInvoiceId,
  timeZone,
  invoiceHref,
}: {
  billing: MatterBilling;
  isSplit: boolean;
  selectedInvoiceId: string | null;
  /** Viewer's profile zone, for the invoice issue / due instants. */
  timeZone: string;
  invoiceHref: (invId: string) => string;
}) {
  return (
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
            <div className="text-2xs text-ink-4">Generate the first one from WIP below.</div>
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
                const cellLink = (children: React.ReactNode, extraClasses?: string) => (
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
                      isSelected ? "bg-brand-tint hover:bg-brand-tint" : "hover:bg-paper-2",
                    )}
                  >
                    <TableCell className="font-mono text-xs p-0">
                      {cellLink(
                        <>
                          {inv.invoiceNumber}
                          {inv.kind === "internal_record" && (
                            <Badge
                              variant="neutral"
                              className="ml-2 font-sans"
                              title="Internal record — closes WIP without billing the client. Excluded from Outstanding AR."
                            >
                              internal
                            </Badge>
                          )}
                          {inv.lineItemCount > 0 && (
                            <span className="ml-2 text-2xs text-ink-4 font-sans">
                              · {inv.lineItemCount} {inv.lineItemCount === 1 ? "item" : "items"}
                            </span>
                          )}
                        </>,
                        cn("pl-4", isSelected ? "text-brand-700 font-semibold" : "text-ink"),
                      )}
                    </TableCell>
                    <TableCell className="p-0">
                      {cellLink(
                        <span className="inline-flex items-center gap-1 flex-wrap">
                          <span
                            className={`inline-block text-2xs font-medium px-2 py-0.5 rounded-full border ${INVOICE_STATUS_CLASS[inv.status] ?? INVOICE_STATUS_CLASS.draft}`}
                          >
                            {invoiceStatusLabel(inv.status, inv.kind as InvoiceKind)}
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
                              <Badge
                                variant="neutral"
                                title="Some payment recorded but a balance remains."
                              >
                                partial
                              </Badge>
                            )}
                        </span>,
                      )}
                    </TableCell>
                    <TableCell className="text-2xs font-mono text-ink-3 p-0">
                      {cellLink(formatDate(inv.issueDate, "medium", timeZone))}
                    </TableCell>
                    <TableCell className="text-2xs font-mono p-0">
                      {cellLink(
                        <span
                          className={
                            inv.daysUntilDue !== null && inv.daysUntilDue < 0
                              ? "text-warn font-medium"
                              : "text-ink-3"
                          }
                        >
                          {formatDate(inv.dueDate, "medium", timeZone)}
                          {inv.daysUntilDue !== null && inv.daysUntilDue < 0 && (
                            <span className="ml-1 text-warn">
                              ({Math.abs(inv.daysUntilDue)}d late)
                            </span>
                          )}
                        </span>,
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
                            inv.status !== "void" && inv.balance > 0 ? "text-ink" : "text-ink-4"
                          }
                        >
                          {/* A voided invoice owes nothing (its stored
                              balance is just the untouched total). */}
                          {inv.status === "void" ? "—" : formatMoney(inv.balance)}
                        </span>,
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
  );
}
