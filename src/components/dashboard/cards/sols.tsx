import { Scale } from "lucide-react";
import type { SolsData } from "@/lib/queries/dashboard-cards";
import { SOL_WINDOW_DAYS } from "@/lib/queries/dashboard-cards";
import { DueLabel } from "@/components/shared/due-label";
import { DashboardCard, DashboardRow } from "../dashboard-card";

/** Unsatisfied statutes of limitations in the next 90 days (lapsed
 *  ones first). */
export function SolsCard({ data }: { data: SolsData }) {
  return (
    <DashboardCard
      title="Upcoming SOLs"
      warn={data.lapsed > 0 ? `${data.lapsed} lapsed` : undefined}
      empty={
        data.items.length === 0
          ? { icon: Scale, text: `No open SOLs in the next ${SOL_WINDOW_DAYS} days.` }
          : null
      }
    >
      <div className="flex flex-col">
        {data.items.map((s) => (
          <DashboardRow key={s.matterId} href={`/matters/${s.matterId}`}>
            <div className="min-w-0 flex-1 truncate text-xs text-ink">{s.matterName}</div>
            <DueLabel dueDate={s.solDate} days={s.days} className="shrink-0" />
          </DashboardRow>
        ))}
        {data.hidden > 0 && <div className="pt-2 text-2xs text-ink-4">+{data.hidden} more</div>}
      </div>
    </DashboardCard>
  );
}
