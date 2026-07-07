/**
 * Reports — AR aging card.
 *
 * Outstanding client invoices (status sent / partial) in four age
 * buckets from issue date, with per-bucket totals + counts as CSS
 * bars, then a "worst offenders" list — the five oldest unpaid
 * invoices, each linking to its matter's billing tab.
 *
 * Server component, read-only. Data shape from `getArAgingReport`
 * in src/lib/queries/reports.ts.
 */

import Link from "next/link";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ArAgingReport } from "@/lib/queries/reports";

/** Money with cents — AR is the one place rounding reads sloppy. */
const formatMoney = (n: number): string =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ArAgingCard({ report }: { report: ArAgingReport }) {
  const scale = Math.max(1, ...report.buckets.map((b) => b.total));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          AR aging
          <span className="text-2xs font-mono font-normal text-ink-4">
            {report.invoiceCount} outstanding
          </span>
          <span className="ml-auto text-xs font-mono font-medium text-ink">
            {formatMoney(report.totalOutstanding)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 flex flex-col gap-4">
        {report.invoiceCount === 0 ? (
          <div className="py-2 text-xs text-ink-4">
            No outstanding client invoices. Nothing to chase.
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              {report.buckets.map((b) => {
                // 90+ money is the emergency — tint the bar to match.
                const overdue = b.key === "90+" && b.total > 0;
                return (
                  <div key={b.key} className="flex items-center gap-2">
                    <span className="w-20 shrink-0 text-2xs text-ink-3">
                      {b.label}
                    </span>
                    <div className="flex-1 h-1.5 bg-paper-2 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          overdue ? "bg-warn" : "bg-brand-500"
                        )}
                        style={{ width: `${(b.total / scale) * 100}%` }}
                      />
                    </div>
                    <span className="w-28 shrink-0 text-right text-2xs font-mono text-ink">
                      {formatMoney(b.total)}
                      <span className="text-ink-4"> · {b.count}</span>
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col gap-1">
              <div className="text-2xs font-semibold uppercase tracking-wider text-ink-4">
                Oldest outstanding
              </div>
              {report.worstOffenders.map((inv) => (
                <div
                  key={inv.invoiceId}
                  className="flex items-center gap-2 py-1 border-b border-line/60 last:border-b-0"
                >
                  <span className="text-2xs font-mono text-ink-3 shrink-0">
                    {inv.invoiceNumber}
                  </span>
                  <Link
                    href={`/matters/${inv.matterId}/billing`}
                    className="text-xs text-ink truncate hover:text-brand-700 hover:underline"
                  >
                    {inv.matterName}
                  </Link>
                  <span className="ml-auto shrink-0 text-2xs font-mono text-warn">
                    {inv.daysOutstanding}d
                  </span>
                  <span className="shrink-0 text-2xs font-mono text-ink">
                    {formatMoney(inv.outstanding)}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
