import { CalendarX } from "lucide-react";
import type { AgendaItem } from "@/lib/queries/dashboard";
import { DashboardCard, DashboardRow } from "../dashboard-card";

export function AgendaCard({ items }: { items: AgendaItem[] }) {
  return (
    <DashboardCard
      title="Today's agenda"
      viewAllHref="/calendar?view=day"
      empty={
        items.length === 0
          ? { icon: CalendarX, text: "No events scheduled for today." }
          : null
      }
    >
      <div className="flex flex-col">
        {items.map((item) => (
          <DashboardRow key={item.id}>
            <span className="w-16 shrink-0 text-xs text-ink-3 tabular-nums">
              {item.time}
            </span>
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: item.color }}
            />
            <span className="truncate text-xs text-ink">{item.title}</span>
            <span className="ml-auto shrink-0 text-2xs text-ink-4">
              {item.area}
            </span>
          </DashboardRow>
        ))}
      </div>
    </DashboardCard>
  );
}
