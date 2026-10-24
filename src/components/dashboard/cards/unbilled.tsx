import { Receipt } from "lucide-react";
import type { UnbilledData } from "@/lib/queries/dashboard-cards";
import { formatMoney } from "@/lib/format-money";
import { formatHours } from "@/lib/time-entry-constants";
import { DashboardCard, DashboardRow } from "../dashboard-card";

/** Unbilled time by matter. The page only renders this with
 *  `billing.view` (the query returns null without it). */
export function UnbilledCard({ data }: { data: UnbilledData }) {
  return (
    <DashboardCard
      title="Unbilled time"
      empty={data.items.length === 0 ? { icon: Receipt, text: "No unbilled time." } : null}
    >
      <div className="flex items-baseline justify-between pb-1">
        <span className="text-xs text-ink-3">{formatHours(data.totalHours)}h unbilled</span>
        <span className="text-sm font-medium text-ink tabular-nums">
          {formatMoney(data.totalAmount, { cents: false })}
        </span>
      </div>
      <div className="flex flex-col">
        {data.items.map((m) => (
          <DashboardRow key={m.matterId} href={`/matters/${m.matterId}/billing`}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs text-ink">{m.matterName}</div>
              <div className="text-2xs text-ink-4 tabular-nums">{formatHours(m.hours)}h</div>
            </div>
            <span className="shrink-0 text-xs text-ink tabular-nums">
              {formatMoney(m.amount, { cents: false })}
            </span>
          </DashboardRow>
        ))}
        {data.hidden > 0 && (
          <div className="pt-2 text-2xs text-ink-4">+{data.hidden} more matters</div>
        )}
      </div>
    </DashboardCard>
  );
}
