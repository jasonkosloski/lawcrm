import type { FirmPulse } from "@/lib/queries/dashboard";
import { DashboardCard } from "../dashboard-card";
import { formatMoney } from "@/lib/format-money";
import { percentOf } from "./format";

/** Null without reports.view - the card renders nothing. */
export function PulseCard({ pulse }: { pulse: FirmPulse | null }) {
  if (!pulse) return null;
  const mtdPct = percentOf(pulse.billableMtd, pulse.billableGoal);
  return (
    <DashboardCard title="Firm pulse">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-ink-3">Billable hours this month</span>
          <span className="text-sm font-medium text-ink tabular-nums">
            {pulse.billableMtd.toFixed(1)}h
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-paper-2">
          <div
            className="h-full rounded-full bg-brand-700"
            style={{ width: `${mtdPct}%` }}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-ink-3">Collection rate</span>
          <span className="text-sm font-medium text-ink tabular-nums">
            {pulse.collectionRate > 0
              ? `${pulse.collectionRate.toFixed(1)}%`
              : "—"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-ink-3">A/R outstanding</span>
          <span className="text-sm font-medium text-ink tabular-nums">
            {pulse.arOutstanding > 0 ? formatMoney(pulse.arOutstanding, { cents: false }) : "—"}
          </span>
        </div>
      </div>
    </DashboardCard>
  );
}
