/** "Billing": the client's invoices and, for the primary client, the trust account. */

import Link from "next/link";
import { TRUST_TXN_TYPE_LABEL, type TrustTxnType } from "@/lib/billing-form";
import { formatDate } from "@/lib/format-date";
import { formatMoney } from "@/lib/format-money";
import type { PortalInvoiceRow, PortalTrustEntry } from "@/lib/portal/billing";
import { PORTAL_TIME_ZONE } from "@/lib/portal/time-zone";

const CHIP = "rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap";

function StatusChip({ row }: { row: PortalInvoiceRow }) {
  if (row.overdue) {
    return <span className={`${CHIP} border-line bg-danger-soft text-danger`}>Overdue</span>;
  }
  if (row.status === "paid") {
    return <span className={`${CHIP} border-line bg-ok-soft text-ok`}>Paid</span>;
  }
  if (row.status === "partial") {
    return (
      <span className={`${CHIP} border-warn-border bg-warn-soft text-warn`}>Partially paid</span>
    );
  }
  return <span className={`${CHIP} border-brand-200 bg-brand-tint text-brand-700`}>Sent</span>;
}

const day = (d: Date) => formatDate(d, "medium", PORTAL_TIME_ZONE);
const th = "px-4 py-2.5 font-medium";
const num = "px-4 py-3 text-right tabular-nums";

function trustTypeLabel(type: string): string {
  return TRUST_TXN_TYPE_LABEL[type as TrustTxnType] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

export function BillingSection({
  matterId,
  invoices,
  trust,
}: {
  matterId: string;
  invoices: PortalInvoiceRow[];
  trust: { balance: number; entries: PortalTrustEntry[] } | null;
}) {
  return (
    <section aria-labelledby="billing-heading" className="flex flex-col gap-3">
      <h2 id="billing-heading" className="text-sm font-semibold text-ink-2">
        Billing
      </h2>

      {invoices.length > 0 ? (
        <div className="overflow-x-auto rounded-xl bg-white shadow-xs ring-1 ring-line">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-line-2 text-left text-ink-3">
                <th scope="col" className={th}>
                  Invoice
                </th>
                <th scope="col" className={th}>
                  Issued
                </th>
                <th scope="col" className={th}>
                  Due
                </th>
                <th scope="col" className={`${th} text-right`}>
                  Total
                </th>
                <th scope="col" className={`${th} text-right`}>
                  Paid
                </th>
                <th scope="col" className={`${th} text-right`}>
                  Balance
                </th>
                <th scope="col" className={th}>
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-2">
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td className="px-4 py-3">
                    <Link
                      href={`/matters/${matterId}/invoices/${i.id}`}
                      className="font-medium text-brand-700 underline-offset-2 hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
                    >
                      {i.invoiceNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink-2">{day(i.issueDate)}</td>
                  <td className="px-4 py-3 text-ink-2">{day(i.dueDate)}</td>
                  <td className={num}>{formatMoney(i.totalAmount)}</td>
                  <td className={num}>{formatMoney(i.paidAmount)}</td>
                  <td className={`${num} font-medium text-ink`}>{formatMoney(i.balance)}</td>
                  <td className="px-4 py-3">
                    <StatusChip row={i} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {trust ? (
        <div className="flex flex-col gap-4 rounded-xl bg-white p-5 shadow-xs ring-1 ring-line">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-ink">Trust account</h3>
              <p className="text-sm text-ink-3">Funds held in trust for this matter.</p>
            </div>
            <p className="font-display text-2xl font-medium text-brand-900 tabular-nums">
              {formatMoney(trust.balance)}
            </p>
          </div>
          {trust.entries.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="border-b border-line-2 text-left text-ink-3">
                    <th scope="col" className={th}>
                      Date
                    </th>
                    <th scope="col" className={th}>
                      Type
                    </th>
                    <th scope="col" className={th}>
                      Description
                    </th>
                    <th scope="col" className={`${th} text-right`}>
                      Amount
                    </th>
                    <th scope="col" className={`${th} text-right`}>
                      Running balance
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-2">
                  {trust.entries.map((e) => (
                    <tr key={e.id}>
                      <td className="px-4 py-3 text-ink-2">
                        {formatDate(e.date, "medium", "UTC")}
                      </td>
                      <td className="px-4 py-3 text-ink-2">{trustTypeLabel(e.type)}</td>
                      <td className="px-4 py-3 text-ink-2">{e.description}</td>
                      <td className={num}>{formatMoney(e.amount)}</td>
                      <td className={num}>{formatMoney(e.runningBalance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
