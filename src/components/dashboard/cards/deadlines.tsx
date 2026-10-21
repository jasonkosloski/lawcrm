import { CalendarCheck } from "lucide-react";
import type { DeadlinesCard as DeadlinesData } from "@/lib/queries/dashboard";
import { DashboardCard, DashboardRow, LatePill } from "../dashboard-card";

export function DeadlinesCard({ data }: { data: DeadlinesData }) {
  return (
    <DashboardCard
      title="Deadlines this week"
      viewAllHref="/calendar?show=deadlines"
      empty={
        data.items.length === 0
          ? {
              icon: CalendarCheck,
              text: "No open deadlines due in the next 7 days.",
            }
          : null
      }
    >
      <div className="flex flex-col">
        {data.items.map((d) => (
          <DashboardRow key={d.id} href={`/matters/${d.matterId}/deadlines`}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs text-ink">{d.title}</div>
              <div className="truncate font-mono text-3xs uppercase tracking-wider text-ink-4">
                {d.matterName}
              </div>
            </div>
            <LatePill
              tone={
                d.days < 0 || d.kind === "critical"
                  ? "warn"
                  : d.kind === "auto_rule"
                    ? "brand"
                    : "muted"
              }
            >
              {d.days < 0 ? `${Math.abs(d.days)}d late` : `${d.days}d`}
            </LatePill>
          </DashboardRow>
        ))}
        {data.overdueHidden > 0 && (
          <div className="pt-2 font-mono text-2xs text-ink-4">
            +{data.overdueHidden} more overdue
          </div>
        )}
      </div>
    </DashboardCard>
  );
}
