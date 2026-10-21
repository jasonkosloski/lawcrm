import { CalendarCheck } from "lucide-react";
import type { DeadlinesCard as DeadlinesData } from "@/lib/queries/dashboard";
import { DueLabel } from "@/components/shared/due-label";
import { DashboardCard, DashboardRow } from "../dashboard-card";

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
              <div className="flex items-center gap-1.5 text-xs text-ink">
                <span className="truncate">{d.title}</span>
                {d.kind === "critical" && (
                  <span className="shrink-0 text-2xs font-medium text-danger">
                    Critical
                  </span>
                )}
              </div>
              <div className="truncate text-2xs text-ink-4">
                {d.matterName}
              </div>
            </div>
            <DueLabel dueDate={d.dueDate} days={d.days} className="shrink-0" />
          </DashboardRow>
        ))}
        {data.overdueHidden > 0 && (
          <div className="pt-2 text-2xs text-ink-4">
            +{data.overdueHidden} more overdue
          </div>
        )}
      </div>
    </DashboardCard>
  );
}
