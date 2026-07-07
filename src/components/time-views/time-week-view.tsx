/**
 * Time Week View
 *
 * One row per day of the viewer's week: a horizontal hour bar
 * segmented per matter (matter color), the day's total + billable
 * hours at the row end, and a week footer with running totals.
 * Billable vs non-billable shows inside each matter segment — the
 * billable portion renders solid, the non-billable remainder in
 * the same color at reduced opacity.
 *
 * Read-only v1 (server component, no interaction): each segment
 * and legend chip links to its matter's Time tab, where entries
 * are created/edited. Days link into the /time day view for
 * reconciliation.
 */

import Link from "next/link";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import type { MyWeekTime, WeekDayTime } from "@/lib/queries/time";
import { buildTimeHref } from "./time-view-utils";

/** Bar scale: the week's busiest day, floored at 8h so a light
 *  week doesn't blow tiny entries up to full-width bars. */
const MIN_SCALE_HOURS = 8;

export function TimeWeekView({
  week,
  todayKey,
}: {
  week: MyWeekTime;
  /** YYYY-MM-DD of the viewer's today (their TZ) — highlights the row. */
  todayKey: string;
}) {
  const scale = Math.max(
    MIN_SCALE_HOURS,
    ...week.days.map((d) => d.totalHours)
  );

  // Legend: every matter touched this week, deduped, widest first.
  const legend = new Map<
    string,
    { matterId: string; matterName: string; matterColor: string; hours: number }
  >();
  for (const day of week.days) {
    for (const seg of day.segments) {
      const cur = legend.get(seg.matterId);
      if (cur) cur.hours += seg.hours;
      else
        legend.set(seg.matterId, {
          matterId: seg.matterId,
          matterName: seg.matterName,
          matterColor: seg.matterColor,
          hours: seg.hours,
        });
    }
  }
  const legendRows = [...legend.values()].sort((a, b) => b.hours - a.hours);

  return (
    <div className="flex-1 overflow-y-auto p-3 sm:p-5 flex flex-col gap-4">
      <div className="rounded-md border border-line bg-card overflow-hidden">
        {week.days.map((day) => (
          <DayRow
            key={day.dayKey}
            day={day}
            scale={scale}
            isToday={day.dayKey === todayKey}
          />
        ))}

        {/* Week running totals */}
        <div className="flex items-center justify-between gap-3 px-3 sm:px-4 py-2.5 bg-paper-2 border-t border-line">
          <span className="text-2xs font-semibold uppercase tracking-wider text-ink-3">
            Week total
          </span>
          <span className="text-xs font-mono text-ink">
            {week.totalHours.toFixed(1)}h
            <span className="text-ink-4">
              {" · "}
              {week.billableHours.toFixed(1)}h billable
            </span>
          </span>
        </div>
      </div>

      {legendRows.length > 0 ? (
        <div className="flex items-center gap-2 flex-wrap">
          {legendRows.map((m) => (
            <Link
              key={m.matterId}
              href={`/matters/${m.matterId}/time`}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-line bg-white text-2xs text-ink-2 hover:border-brand-300 hover:text-brand-700"
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: m.matterColor }}
              />
              <span className="max-w-40 truncate">{m.matterName}</span>
              <span className="font-mono text-ink-4">{m.hours.toFixed(1)}h</span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="text-xs text-ink-4 text-center py-4">
          No time logged this week yet — entries are added from a
          matter&rsquo;s Time tab.
        </div>
      )}
    </div>
  );
}

function DayRow({
  day,
  scale,
  isToday,
}: {
  day: WeekDayTime;
  scale: number;
  isToday: boolean;
}) {
  const focal = parseISO(day.dayKey);
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 sm:px-4 py-2 border-b border-line last:border-b-0",
        isToday && "bg-brand-soft/40"
      )}
    >
      {/* Day label → deep-link into the reconciliation view */}
      <Link
        href={buildTimeHref("day", focal)}
        className="w-16 shrink-0 flex flex-col leading-tight hover:text-brand-700"
      >
        <span
          className={cn(
            "text-2xs font-semibold uppercase tracking-wider",
            isToday ? "text-brand-700" : "text-ink-3"
          )}
        >
          {format(focal, "EEE")}
        </span>
        <span className="text-xs text-ink-4 font-mono">
          {format(focal, "MMM d")}
        </span>
      </Link>

      {/* Hour bar — one segment per matter, billable solid +
          non-billable remainder at reduced opacity. */}
      <div className="flex-1 min-w-0 h-5 rounded bg-paper-2 overflow-hidden flex">
        {day.segments.map((seg) => {
          const nonBillable = seg.hours - seg.billableHours;
          return (
            <Link
              key={seg.matterId}
              href={`/matters/${seg.matterId}/time`}
              className="h-full flex hover:opacity-80 transition-opacity"
              style={{ width: `${(seg.hours / scale) * 100}%` }}
              title={`${seg.matterName} — ${seg.hours.toFixed(1)}h (${seg.billableHours.toFixed(1)}h billable)`}
            >
              {seg.billableHours > 0 && (
                <span
                  className="h-full"
                  style={{
                    width: `${(seg.billableHours / seg.hours) * 100}%`,
                    background: seg.matterColor,
                  }}
                />
              )}
              {nonBillable > 0.001 && (
                <span
                  className="h-full flex-1"
                  style={{ background: seg.matterColor, opacity: 0.35 }}
                />
              )}
            </Link>
          );
        })}
      </div>

      {/* Day totals */}
      <div className="w-28 shrink-0 text-right text-xs font-mono">
        {day.totalHours > 0 ? (
          <>
            <span className="text-ink">{day.totalHours.toFixed(1)}h</span>
            <span className="text-2xs text-ink-4">
              {" · "}
              {day.billableHours.toFixed(1)}h bill
            </span>
          </>
        ) : (
          <span className="text-ink-4">—</span>
        )}
      </div>
    </div>
  );
}
