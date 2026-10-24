import type { TimeWeekData } from "@/lib/queries/dashboard-cards";
import { formatHours } from "@/lib/time-entry-constants";
import { formatDateOnly, parseDateOnly } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { DashboardCard } from "../dashboard-card";

const PLOT_HEIGHT = 96;

/** "Wed, Apr 15" for the tooltip; "Wed" for the axis. */
const dayLabel = (dayKey: string) => formatDateOnly(parseDateOnly(dayKey)!, "short_weekday");

/** The viewer's hours per day this week against the firm daily goal.
 *  One series, so no legend: the title names it, the goal line is
 *  labelled, and each bar carries its value as a tooltip and label. */
export function TimeWeekCard({ data }: { data: TimeWeekData }) {
  const max = Math.max(data.dailyGoal, ...data.days.map((d) => d.totalHours), 1);
  const goalPct = (data.dailyGoal / max) * 100;
  return (
    <DashboardCard title="Time this week" viewAllHref="/time">
      <div className="flex items-baseline justify-between pb-2">
        <span className="text-xs text-ink-3">{formatHours(data.billableHours)}h billable</span>
        <span className="text-sm font-medium text-ink tabular-nums">
          {formatHours(data.totalHours)}h
        </span>
      </div>
      <div className="relative" style={{ height: PLOT_HEIGHT }}>
        {data.dailyGoal > 0 && (
          <div
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-ink-4"
            style={{ bottom: `${goalPct}%` }}
          >
            <span className="absolute -top-4 right-0 text-2xs text-ink-4">
              Goal {formatHours(data.dailyGoal)}h
            </span>
          </div>
        )}
        <ol className="flex h-full items-end gap-1.5 border-b border-line">
          {data.days.map((d) => {
            const label = dayLabel(d.dayKey);
            const isToday = d.dayKey === data.todayKey;
            return (
              <li
                key={d.dayKey}
                className="group flex h-full flex-1 items-end"
                title={`${label}: ${formatHours(d.totalHours)}h`}
                aria-label={`${label}: ${formatHours(d.totalHours)} hours`}
              >
                <div
                  className={cn(
                    "w-full rounded-t-[4px] transition-opacity group-hover:opacity-80",
                    isToday ? "bg-brand-700" : "bg-brand-300",
                  )}
                  style={{ height: `${(d.totalHours / max) * 100}%` }}
                />
              </li>
            );
          })}
        </ol>
      </div>
      <div className="flex gap-1.5 pt-1">
        {data.days.map((d) => (
          <span
            key={d.dayKey}
            className={cn(
              "flex-1 text-center text-2xs",
              d.dayKey === data.todayKey ? "font-medium text-ink" : "text-ink-4",
            )}
          >
            {dayLabel(d.dayKey).split(",")[0]}
          </span>
        ))}
      </div>
    </DashboardCard>
  );
}
