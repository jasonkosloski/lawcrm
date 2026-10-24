import { Pin } from "lucide-react";
import type { PinnedMatterItem } from "@/lib/queries/dashboard-cards";
import { DueLabel } from "@/components/shared/due-label";
import { DashboardCard, DashboardRow } from "../dashboard-card";

/** The viewer's pinned matters with stage and next open deadline. */
export function PinnedCard({ items }: { items: PinnedMatterItem[] }) {
  return (
    <DashboardCard
      title="Pinned matters"
      empty={
        items.length === 0
          ? { icon: Pin, text: "Pin a matter from its page to keep it here." }
          : null
      }
    >
      <div className="flex flex-col">
        {items.map((m) => (
          <DashboardRow key={m.id} href={`/matters/${m.id}`}>
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: m.color }}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs text-ink">{m.name}</div>
              <div className="truncate text-2xs text-ink-4">
                {m.stageName}
                {m.nextDeadline && ` · ${m.nextDeadline.title}`}
              </div>
            </div>
            {m.nextDeadline && (
              <DueLabel
                dueDate={m.nextDeadline.dueDate}
                days={m.nextDeadline.days}
                className="shrink-0"
              />
            )}
          </DashboardRow>
        ))}
      </div>
    </DashboardCard>
  );
}
