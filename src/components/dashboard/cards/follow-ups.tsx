import { BellOff } from "lucide-react";
import type { FollowUpItem } from "@/lib/queries/dashboard";
import { DashboardCard, DashboardRow, LatePill } from "../dashboard-card";

/** Row in the "Follow up today" card. Click navigates to the source
 *  thread (matter-scoped for filed email; firm-wide for messenger which
 *  doesn't have a matter-scoped view yet). */
function FollowUpRow({ item }: { item: FollowUpItem }) {
  const href =
    item.kind === "email"
      ? `/communication?view=email&thread=${item.id}`
      : `/communication?view=messages&thread=${item.id}`;
  const glyph = item.kind === "email" ? "✉ " : "💬 ";
  return (
    <DashboardRow href={href}>
      <span
        className={
          "h-1.5 w-1.5 shrink-0 rounded-full " +
          (item.isOverdue ? "bg-warn" : "bg-brand-500")
        }
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-ink">{item.label}</div>
        {item.matterName && (
          <div className="truncate font-mono text-3xs uppercase tracking-wider text-ink-4">
            {item.matterName}
          </div>
        )}
      </div>
      {item.isOverdue ? (
        <LatePill tone="warn">{glyph}Late</LatePill>
      ) : (
        <span className="shrink-0 font-mono text-2xs text-ink-4">
          {glyph}Today
        </span>
      )}
    </DashboardRow>
  );
}

export function FollowUpsCard({ items }: { items: FollowUpItem[] }) {
  const overdue = items.filter((f) => f.isOverdue).length;
  return (
    <DashboardCard
      title="Follow up today"
      count={items.length}
      warn={overdue > 0 ? `${overdue} overdue` : undefined}
      viewAllHref="/communication"
      empty={
        items.length === 0
          ? {
              icon: BellOff,
              text: "Nothing flagged for today. Snooze a thread by clicking the bell on its reader header.",
            }
          : null
      }
    >
      <div className="flex flex-col">
        {items.map((f) => (
          <FollowUpRow key={`${f.kind}-${f.id}`} item={f} />
        ))}
      </div>
    </DashboardCard>
  );
}
