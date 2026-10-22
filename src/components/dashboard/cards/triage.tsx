import { CheckCircle2 } from "lucide-react";
import { DueLabel } from "@/components/shared/due-label";
import type { TriageData, TriageRow } from "@/lib/queries/dashboard-triage";
import { DashboardCard, DashboardRow } from "../dashboard-card";

function TriageItem({ row }: { row: TriageRow }) {
  return (
    <DashboardRow href={row.href ?? undefined}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-ink">{row.title}</div>
        {row.context && <div className="truncate text-2xs text-ink-4">{row.context}</div>}
      </div>
      {row.days !== null && <DueLabel dueDate={row.dueDate} days={row.days} className="shrink-0" />}
    </DashboardRow>
  );
}

/** "Needs me now": overdue / due-today work and things waiting on the
 *  viewer, one short list per kind. Groups the viewer may not see are
 *  already absent from `data`. */
export function TriageCard({ data }: { data: TriageData }) {
  return (
    <DashboardCard
      title="Needs me now"
      empty={
        data.groups.length === 0
          ? { icon: CheckCircle2, text: "Nothing needs you right now." }
          : null
      }
    >
      <div className="grid gap-x-6 gap-y-3 @2xl:grid-cols-2">
        {data.groups.map((g) => (
          <section key={g.key} aria-label={g.label}>
            <div className="mb-1 flex items-center gap-2">
              <h3 className="text-xs font-semibold text-ink">{g.label}</h3>
              <span className="text-2xs text-ink-4 tabular-nums">{g.total}</span>
            </div>
            <div className="flex flex-col">
              {g.rows.map((r) => (
                <TriageItem key={r.id} row={r} />
              ))}
              {g.hidden > 0 && <div className="pt-2 text-2xs text-ink-4">+{g.hidden} more</div>}
            </div>
          </section>
        ))}
      </div>
    </DashboardCard>
  );
}
