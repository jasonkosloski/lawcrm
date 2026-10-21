import { FileSearch } from "lucide-react";
import type { RecordsChaseItem } from "@/lib/queries/records-requests";
import { DashboardCard, DashboardRow, LatePill } from "../dashboard-card";

/** Viewer's overdue / due-soon records requests. No fee data. The page
 *  only renders this for viewers with `records.view`. */
export function RecordsCard({ items }: { items: RecordsChaseItem[] }) {
  return (
    <DashboardCard
      title="Records to chase"
      count={items.length}
      empty={
        items.length === 0
          ? {
              icon: FileSearch,
              text: "No records requests need a nudge this week.",
            }
          : null
      }
    >
      <div className="flex flex-col">
        {items.map((r) => (
          <DashboardRow key={r.id} href={r.href}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs text-ink">{r.subject}</div>
              <div className="truncate text-2xs text-ink-4">
                {r.custodianName} · {r.context}
              </div>
            </div>
            {r.label.endsWith("overdue") ? (
              <LatePill tone="danger">{r.label}</LatePill>
            ) : (
              <span className="shrink-0 text-2xs tabular-nums text-ink-4">
                {r.label}
              </span>
            )}
          </DashboardRow>
        ))}
      </div>
    </DashboardCard>
  );
}
