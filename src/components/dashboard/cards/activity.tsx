import { History } from "lucide-react";
import { activityIcon } from "@/lib/activity-icons";
import type { ActivityItem } from "@/lib/queries/dashboard";
import { DashboardCard, DashboardRow } from "../dashboard-card";

export function ActivityCard({
  items,
  canViewActivityLog,
}: {
  items: ActivityItem[];
  canViewActivityLog: boolean;
}) {
  return (
    <DashboardCard
      title="Recent activity"
      viewAllHref={canViewActivityLog ? "/settings/activity" : undefined}
      empty={
        items.length === 0
          ? { icon: History, text: "No recent activity." }
          : null
      }
    >
      <div className="flex flex-col">
        {items.map((item) => {
          const Icon = activityIcon(item.iconName);
          return (
            <DashboardRow key={item.id}>
              <Icon
                size={16}
                strokeWidth={1.75}
                aria-hidden
                className="mt-0.5 shrink-0 self-start text-ink-4"
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-ink">{item.title}</div>
                <div className="truncate text-2xs text-ink-3">{item.detail}</div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5">
                <span className="text-2xs text-ink-4 tabular-nums">
                  {item.time}
                </span>
                <span className="text-2xs text-ink-4">
                  {item.source}
                </span>
              </div>
            </DashboardRow>
          );
        })}
      </div>
    </DashboardCard>
  );
}
