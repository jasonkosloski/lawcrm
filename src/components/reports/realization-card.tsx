/**
 * Reports — Realization card.
 *
 * Trailing 3 months (viewer's calendar), one block per month:
 * billable hours worked → hours billed (as a % of worked, bar) →
 * dollars collected (as a % of billed dollars, bar). Cash-basis
 * collections — payments bucket by when they landed, so a strong
 * collections month can exceed 100%.
 *
 * Server component, read-only. Data shape from
 * `getRealizationReport` in src/lib/queries/reports.ts.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RealizationMonth } from "@/lib/queries/reports";

const formatMoney = (n: number): string =>
  `$${Math.round(n).toLocaleString("en-US")}`;

export function RealizationCard({ months }: { months: RealizationMonth[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          Realization
          <span className="text-2xs font-mono font-normal text-ink-4">
            trailing 3 months
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 flex flex-col gap-3">
        {months.map((m) => (
          <div
            key={m.key}
            className="flex flex-col gap-1.5 py-1.5 border-b border-line/60 last:border-b-0"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ink">{m.label}</span>
              <span className="text-2xs font-mono text-ink-4">
                {m.workedHours.toFixed(1)}h worked
              </span>
            </div>

            {/* Billed as % of worked */}
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-2xs text-ink-3">Billed</span>
              <div className="flex-1 h-1.5 bg-paper-2 rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand-500 rounded-full"
                  style={{ width: `${Math.min(100, m.billedPctOfWorked)}%` }}
                />
              </div>
              <span className="w-32 shrink-0 text-right text-2xs font-mono text-ink">
                {m.billedHours.toFixed(1)}h
                <span className="text-ink-4">
                  {" "}
                  · {m.billedPctOfWorked.toFixed(0)}%
                </span>
              </span>
            </div>

            {/* Collected as % of billed dollars */}
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-2xs text-ink-3">
                Collected
              </span>
              <div className="flex-1 h-1.5 bg-paper-2 rounded-full overflow-hidden">
                <div
                  className="h-full bg-ok rounded-full"
                  style={{ width: `${Math.min(100, m.collectedPctOfBilled)}%` }}
                />
              </div>
              <span className="w-32 shrink-0 text-right text-2xs font-mono text-ink">
                {formatMoney(m.collectedAmount)}
                <span className="text-ink-4">
                  {" "}
                  · {m.collectedPctOfBilled.toFixed(0)}%
                </span>
              </span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
