/**
 * Reports — Utilization card.
 *
 * One horizontal bar per active user for the current month: the
 * billable portion renders solid brand blue, the non-billable
 * remainder at reduced opacity (same billable-inside-total idiom
 * as the /time week view). A hairline tick marks the per-person
 * capacity line (dailyHoursGoal × business days elapsed), and the
 * footer shows firm billable MTD against the monthly goal.
 *
 * Goals are live Firm-row values — settings edits show up on the
 * next render. Server component, read-only.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { UtilizationReport } from "@/lib/queries/reports";

export function UtilizationCard({ report }: { report: UtilizationReport }) {
  // Bars scale against the busiest user OR the capacity line,
  // whichever is larger — so the capacity tick always fits.
  const scale = Math.max(
    report.monthCapacityHours,
    1,
    ...report.users.map((u) => u.totalHours)
  );
  const capacityPct = (report.monthCapacityHours / scale) * 100;
  const goalPct = Math.min(
    100,
    report.monthlyBillableGoal > 0
      ? (report.firmBillableMtd / report.monthlyBillableGoal) * 100
      : 0
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          Utilization
          <span className="text-2xs font-mono font-normal text-ink-4">
            this month
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 flex flex-col gap-3">
        {report.users.length === 0 ? (
          <div className="py-2 text-xs text-ink-4">No active users.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {report.users.map((u) => (
              <div key={u.userId} className="flex items-center gap-2">
                <span
                  className="w-24 shrink-0 text-2xs text-ink-2 truncate"
                  title={u.name}
                >
                  {u.name}
                </span>
                <div className="relative flex-1 h-2 bg-paper-2 rounded-full overflow-hidden">
                  {/* Total hours (non-billable share, faded) */}
                  <div
                    className="absolute inset-y-0 left-0 bg-brand-500/30 rounded-full"
                    style={{ width: `${(u.totalHours / scale) * 100}%` }}
                  />
                  {/* Billable hours (solid) */}
                  <div
                    className="absolute inset-y-0 left-0 bg-brand-500 rounded-full"
                    style={{ width: `${(u.billableHours / scale) * 100}%` }}
                  />
                  {/* Capacity tick — dailyHoursGoal × business days so far */}
                  <div
                    className="absolute inset-y-0 w-px bg-ink/40"
                    style={{ left: `${capacityPct}%` }}
                  />
                </div>
                <span className="w-24 shrink-0 text-right text-2xs font-mono text-ink">
                  {u.billableHours.toFixed(1)}
                  <span className="text-ink-4">
                    {" "}
                    / {u.totalHours.toFixed(1)}h
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="text-2xs text-ink-4">
          Solid = billable, faded = non-billable. Tick ={" "}
          {report.monthCapacityHours.toFixed(0)}h capacity (
          {report.dailyHoursGoal.toFixed(1)}h/day × business days so far).
        </div>

        {/* Firm-wide billable vs monthly goal */}
        <div className="flex flex-col gap-1.5 pt-2 border-t border-line/60">
          <div className="flex items-center justify-between">
            <span className="text-2xs text-ink-3">
              Firm billable (MTD) vs goal
            </span>
            <span className="text-xs font-mono font-medium text-ink">
              {report.firmBillableMtd.toFixed(1)}h
              <span className="text-ink-4">
                {" "}
                / {report.monthlyBillableGoal.toFixed(0)}h
              </span>
            </span>
          </div>
          <div className="h-1.5 bg-paper-2 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-500 rounded-full"
              style={{ width: `${goalPct}%` }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
