/**
 * Invoice Preview — letterhead-style render of a single invoice.
 *
 * Server component. Renders the document body only (firm
 * letterhead, invoice meta, bill-to, line items, totals, notes).
 * The sticky top header (close button + state-machine action
 * buttons) lives in the parent page so the same component can be
 * reused in a future print / PDF route without the chrome.
 *
 * Designed to look like the document that'll eventually be PDF'd
 * and emailed — when that lands (deferred), we render the same
 * tree to a print-friendly route + PDF the result.
 */

import { Building2, FileText } from "lucide-react";
import { invoiceStatusLabel, type InvoiceKind } from "@/lib/billing-form";
import type { FirmProfile } from "@/lib/firm";
import type { InvoiceDetail } from "@/lib/queries/billing";

const formatMoney = (n: number): string =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDate = (d: Date): string =>
  d.toLocaleDateString("en-US", {
    month: "long",
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

export function InvoicePreview({
  invoice,
  firm,
}: {
  invoice: InvoiceDetail;
  firm: FirmProfile;
}) {
  const statusClass = STATUS_META[invoice.status] ?? STATUS_META.draft;
  const isInternal = invoice.kind === "internal_record";
  // Letterhead label flips per kind so the doc reads like what it
  // actually is — a real bill vs. a record-of-work file copy.
  const headerLabel = isInternal ? "Internal Record" : "Invoice";
  const firmAddress = [
    firm.addressLine1,
    firm.addressLine2,
    [firm.city, firm.state, firm.zip].filter(Boolean).join(", "),
  ].filter(Boolean);

  return (
    <div className="flex flex-col h-full">
      {/* Document body — scrolls; action bar is sticky below. The
          parent <aside> already provides the rounded border + bg
          for the pane chrome, so we don't double up here. Letting
          the letterhead sit flush against that pane reads more
          like "the right side IS the invoice" than "a piece of
          paper sitting on a workspace". */}
      <div className="flex-1 overflow-y-auto bg-white">
        <div>
          {/* Letterhead */}
          <div className="px-6 py-4 border-b border-line">
            <div className="flex items-start justify-between gap-6">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center shrink-0 border border-brand-100">
                  <Building2 size={18} />
                </div>
                <div className="min-w-0">
                  <div className="text-base font-display font-medium text-ink truncate">
                    {firm.name}
                  </div>
                  {firmAddress.length > 0 && (
                    <div className="text-2xs text-ink-4 leading-relaxed mt-0.5">
                      {firmAddress.map((line, i) => (
                        <div key={i}>{line}</div>
                      ))}
                    </div>
                  )}
                  {(firm.phone || firm.email) && (
                    <div className="text-2xs text-ink-4 mt-1 font-mono">
                      {[firm.phone, firm.email].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-2xs font-mono uppercase tracking-wider text-ink-4">
                  {headerLabel}
                </div>
                <div className="text-lg font-display font-medium text-ink mt-0.5">
                  {invoice.invoiceNumber}
                </div>
                <span
                  className={`inline-block mt-1.5 text-2xs font-medium px-2 py-0.5 rounded-full border ${statusClass}`}
                >
                  {invoiceStatusLabel(
                    invoice.status,
                    invoice.kind as InvoiceKind
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* Meta + Bill-to (or For-file block on internal records) */}
          <div className="px-6 py-4 grid grid-cols-2 gap-6 border-b border-line">
            <div>
              {isInternal ? (
                <>
                  <div className="text-2xs font-mono uppercase tracking-wider text-ink-4 mb-1">
                    For matter file
                  </div>
                  <div className="text-sm font-medium text-ink">
                    Internal record — not billed
                  </div>
                  <div className="text-2xs text-ink-4 mt-1 leading-relaxed max-w-xs">
                    Closes WIP without invoicing. Excluded from
                    Outstanding AR; the matter&apos;s Trust ledger is
                    unaffected.
                  </div>
                  <div className="text-2xs text-ink-4 mt-2">
                    <span className="font-mono uppercase tracking-wider">
                      Re:
                    </span>{" "}
                    {invoice.matterName}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-2xs font-mono uppercase tracking-wider text-ink-4 mb-1">
                    Bill to
                  </div>
                  <div className="text-sm font-medium text-ink">
                    {invoice.clientName ?? "—"}
                  </div>
                  {invoice.clientEmail && (
                    <div className="text-2xs text-ink-3 font-mono mt-0.5">
                      {invoice.clientEmail}
                    </div>
                  )}
                  {invoice.clientAddress && (
                    <div className="text-2xs text-ink-4 mt-1 leading-relaxed">
                      {invoice.clientAddress.line1 && (
                        <div>{invoice.clientAddress.line1}</div>
                      )}
                      {(invoice.clientAddress.city ||
                        invoice.clientAddress.state ||
                        invoice.clientAddress.zip) && (
                        <div>
                          {[
                            invoice.clientAddress.city,
                            invoice.clientAddress.state,
                            invoice.clientAddress.zip,
                          ]
                            .filter(Boolean)
                            .join(", ")}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="text-2xs text-ink-4 mt-2">
                    <span className="font-mono uppercase tracking-wider">
                      Re:
                    </span>{" "}
                    {invoice.matterName}
                  </div>
                </>
              )}
            </div>
            <dl className="text-2xs grid grid-cols-[5rem_1fr] gap-y-1 self-start">
              <dt className="text-ink-4">Issued</dt>
              <dd className="text-ink font-mono">
                {formatDate(invoice.issueDate)}
              </dd>
              <dt className="text-ink-4">Due</dt>
              <dd className="text-ink font-mono">
                {formatDate(invoice.dueDate)}
                {invoice.daysUntilDue !== null && invoice.daysUntilDue < 0 && (
                  <span className="text-warn ml-1.5">
                    ({Math.abs(invoice.daysUntilDue)} days late)
                  </span>
                )}
              </dd>
              <dt className="text-ink-4">Total</dt>
              <dd className="text-ink font-mono font-medium">
                {formatMoney(invoice.totalAmount)}
              </dd>
              {invoice.paidAmount > 0 && (
                <>
                  <dt className="text-ink-4">Paid</dt>
                  <dd className="text-ok font-mono font-medium">
                    {formatMoney(invoice.paidAmount)}
                  </dd>
                </>
              )}
              <dt className="text-ink-4">Balance</dt>
              <dd className="text-ink font-mono font-semibold">
                {formatMoney(invoice.balance)}
              </dd>
            </dl>
          </div>

          {/* Line items */}
          <div className="px-6 py-4 border-b border-line">
            <div className="text-2xs font-mono uppercase tracking-wider text-ink-4 mb-2">
              Services
            </div>
            {invoice.lineItems.length === 0 ? (
              <div className="text-xs text-ink-4 italic py-4">
                No line items linked to this invoice.
                {invoice.status === "void" &&
                  " (Voiding an invoice unlinks its time entries back to billable WIP.)"}
              </div>
            ) : (
              <table className="w-full text-2xs">
                <thead>
                  <tr className="text-ink-4 border-b border-line">
                    <th className="text-left font-mono uppercase tracking-wider pb-1.5">
                      Date
                    </th>
                    <th className="text-left font-mono uppercase tracking-wider pb-1.5">
                      Description
                    </th>
                    <th className="text-right font-mono uppercase tracking-wider pb-1.5">
                      Hrs
                    </th>
                    <th className="text-right font-mono uppercase tracking-wider pb-1.5">
                      Rate
                    </th>
                    <th className="text-right font-mono uppercase tracking-wider pb-1.5">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.lineItems.map((li) => (
                    <tr
                      key={li.id}
                      className="border-b border-line/60 last:border-b-0 align-top"
                    >
                      <td className="py-2 font-mono text-ink-3 whitespace-nowrap pr-3">
                        {li.date.toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="text-ink">{li.activity}</div>
                        {li.narrative && (
                          <div className="text-ink-4 mt-0.5">
                            {li.narrative}
                          </div>
                        )}
                        <div className="text-ink-4 font-mono mt-0.5">
                          {li.userInitials}
                        </div>
                      </td>
                      <td className="py-2 text-right font-mono text-ink-3 whitespace-nowrap">
                        {li.hours.toFixed(2)}
                      </td>
                      <td className="py-2 text-right font-mono text-ink-3 whitespace-nowrap">
                        {li.rate !== null ? formatMoney(li.rate) : "—"}
                      </td>
                      <td className="py-2 text-right font-mono text-ink whitespace-nowrap pl-3">
                        {li.amount !== null ? formatMoney(li.amount) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Totals stack */}
          <div className="px-6 py-4 border-b border-line">
            <dl className="ml-auto w-64 text-xs grid grid-cols-[1fr_auto] gap-y-1">
              <dt className="text-ink-3">Subtotal</dt>
              <dd className="text-ink font-mono">
                {formatMoney(invoice.subtotal)}
              </dd>
              {invoice.taxAmount > 0 && (
                <>
                  <dt className="text-ink-3">Tax</dt>
                  <dd className="text-ink font-mono">
                    {formatMoney(invoice.taxAmount)}
                  </dd>
                </>
              )}
              <dt className="text-ink font-medium pt-1 border-t border-line mt-1">
                Total due
              </dt>
              <dd className="text-ink font-mono font-semibold pt-1 border-t border-line mt-1">
                {formatMoney(invoice.balance)}
              </dd>
            </dl>
          </div>

          {/* Notes */}
          {invoice.notes && (
            <div className="px-6 py-4">
              <div className="text-2xs font-mono uppercase tracking-wider text-ink-4 mb-1 flex items-center gap-1.5">
                <FileText size={11} />
                Notes
              </div>
              <div className="text-xs text-ink-3 leading-relaxed whitespace-pre-wrap">
                {invoice.notes}
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
