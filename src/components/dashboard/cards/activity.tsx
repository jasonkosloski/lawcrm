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
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-50">
                <Icon size={13} className="text-brand-500" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-ink">{item.title}</div>
                <div className="truncate text-2xs text-ink-3">{item.detail}</div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5">
                <span className="font-mono text-2xs text-ink-4">
                  {item.time}
                </span>
                <span className="font-mono text-3xs uppercase tracking-wider text-ink-4">
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
