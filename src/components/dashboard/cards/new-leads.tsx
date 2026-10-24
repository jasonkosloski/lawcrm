import { UserPlus } from "lucide-react";
import type { NewLeadsData } from "@/lib/queries/dashboard-cards";
import { NEW_LEADS_DAYS } from "@/lib/queries/dashboard-cards";
import { LEAD_SOURCE_LABEL, LEAD_STAGE_LABEL, type LeadStage } from "@/lib/constants/lead-stage";
import { formatRelative } from "@/lib/format-date";
import { DashboardCard, DashboardRow } from "../dashboard-card";

/** Leads created in the last 7 days that the viewer may see. */
export function NewLeadsCard({ data }: { data: NewLeadsData }) {
  const total = data.items.length + data.hidden;
  return (
    <DashboardCard
      title="New leads"
      count={total}
      viewAllHref="/intake"
      empty={
        total === 0
          ? { icon: UserPlus, text: `No new leads in the last ${NEW_LEADS_DAYS} days.` }
          : null
      }
    >
      <div className="flex flex-col">
        {data.items.map((l) => (
          <DashboardRow key={l.id} href={`/intake/${l.id}`}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs text-ink">{l.name}</div>
              <div className="truncate text-2xs text-ink-4">
                {LEAD_STAGE_LABEL[l.stage as LeadStage] ?? l.stage}
                {l.source && ` · ${LEAD_SOURCE_LABEL[l.source] ?? l.source}`}
              </div>
            </div>
            <span className="shrink-0 text-2xs tabular-nums text-ink-4">
              {formatRelative(l.createdAt)}
            </span>
          </DashboardRow>
        ))}
        {data.hidden > 0 && <div className="pt-2 text-2xs text-ink-4">+{data.hidden} more</div>}
      </div>
    </DashboardCard>
  );
}
