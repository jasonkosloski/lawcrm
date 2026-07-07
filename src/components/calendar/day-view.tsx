/**
 * Day View
 *
 * Single-day focus mode. Layout (top to bottom):
 *
 *   1. All-day row — one full-width `WeekAllDayCell` (drop target
 *      for "make all-day on this date").
 *   2. Deadlines row — the day's deadlines as full pills (title +
 *      matter, kind-colored), not the week view's squeezed chips.
 *      Same color vocabulary as the month view's DeadlinePill.
 *   3. Hour grid — the week view's gutter + ONE full-width
 *      `WeekTimeColumn` (6am–9pm, positioned chips, now-line).
 *
 * The column primitives are reused from `week-day-column.tsx`
 * verbatim — they were already parameterized per-day, so the day
 * view is "a week view with one column" plus richer chrome. That
 * keeps drag-to-reschedule + edge-resize working within the day
 * for free: the full-width column IS the drop target, and the
 * move dispatch comes from the same `useEventMoves` hook WeekView
 * uses (optimistic overlay, rollback, revalidate reconcile).
 *
 * Full-width chips are naturally richer than week columns: the
 * chip body (`ChipBody`) already renders time / location /
 * attendees / matter lines when the chip is tall enough, and at
 * day-view width those lines stop truncating.
 */

"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatHourLabel, HOUR_HEIGHT_PX, HOURS } from "@/lib/calendar-utils";
import { dateKeyInTz } from "@/lib/format-date";
import type {
  CalendarItem,
  CalendarEventRow,
  CalendarDeadlineRow,
} from "@/lib/queries/calendar";
import { WeekAllDayCell, WeekTimeColumn } from "./week-day-column";
import { useEventMoves } from "./use-event-moves";

/** Split a day's items into the three sections the view renders.
 *  Items are bucketed by their user-TZ calendar date (same
 *  discipline as the week view) — the fetch range is already the
 *  single day, but an optimistically-moved event may have left
 *  the day, and trusting the range alone would double-render it.
 *  Deadlines are sorted critical-first (matching the month view's
 *  "deadlines first" priority), events by start time. Exported
 *  for tests. */
export function bucketDayItems(
  items: CalendarItem[],
  dayKey: string,
  tz: string
): {
  allDayEvents: CalendarEventRow[];
  timedEvents: CalendarEventRow[];
  deadlines: CalendarDeadlineRow[];
} {
  const onDay = items.filter(
    (i) =>
      dateKeyInTz(i.kind === "event" ? i.startTime : i.dueDate, tz) === dayKey
  );
  const events = onDay
    .filter((i): i is CalendarEventRow => i.kind === "event")
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  const deadlines = onDay
    .filter((i): i is CalendarDeadlineRow => i.kind === "deadline")
    .sort((a, b) => {
      const rank = (d: CalendarDeadlineRow) =>
        d.deadlineKind === "critical" ? 0 : 1;
      return rank(a) - rank(b);
    });
  return {
    allDayEvents: events.filter((e) => e.isAllDay),
    timedEvents: events.filter((e) => !e.isAllDay),
    deadlines,
  };
}

export function DayView({
  day,
  items,
  canEditEvents = false,
  userTz,
}: {
  /** Noon-UTC Date of the displayed calendar day (from
   *  `calendarDayInTz`). Noon UTC keeps the Date's UTC calendar
   *  components matching the user's calendar day — same
   *  convention as the week/month `days` arrays. */
  day: Date;
  items: CalendarItem[];
  /** When true, chips are draggable + the column exposes drop
   *  zones. The server still gates `moveCalendarEvent` on
   *  `events.edit` regardless. */
  canEditEvents?: boolean;
  /** User's IANA TZ — drives item bucketing + the now-line so a
   *  user in MDT viewing on a UTC server still sees their local
   *  day. */
  userTz: string;
}) {
  // Shared optimistic-move pipeline (same hook as WeekView).
  const { renderItems, moveEvent } = useEventMoves(items);

  const now = new Date();
  const todayKey = dateKeyInTz(now, userTz);
  // Day key from the noon-UTC Date's UTC components — matches
  // what `dateKeyInTz` produces for items on this calendar day.
  const dayKey = `${day.getUTCFullYear()}-${String(
    day.getUTCMonth() + 1
  ).padStart(2, "0")}-${String(day.getUTCDate()).padStart(2, "0")}`;

  const { allDayEvents, timedEvents, deadlines } = bucketDayItems(
    renderItems,
    dayKey,
    userTz
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto [--cal-gutter:36px] sm:[--cal-gutter:56px]">
      {/* All-day row — mirrors the week view's strip so the drop
          target ("make all-day on this date") works identically.
          Deadlines are pulled out into their own section below,
          where there's room to render them as full pills. */}
      <div
        className="grid border-b border-line bg-card"
        style={{
          gridTemplateColumns: "var(--cal-gutter,56px) 1fr",
          minHeight: 36,
        }}
      >
        <div className="text-2xs font-mono text-ink-4 text-right pr-1.5 pt-1 border-r border-line">
          all-day
        </div>
        <WeekAllDayCell
          day={day}
          events={allDayEvents}
          deadlines={[]}
          canEdit={canEditEvents}
          move={moveEvent}
        />
      </div>

      {/* Deadlines — listed, not squeezed into thin bars. Only
          rendered when the day has any, so an empty day stays
          all hour-grid. */}
      {deadlines.length > 0 && (
        <div
          className="grid border-b border-line bg-card"
          style={{ gridTemplateColumns: "var(--cal-gutter,56px) 1fr" }}
        >
          <div className="text-2xs font-mono text-ink-4 text-right pr-1.5 pt-2 border-r border-line">
            due
          </div>
          <div className="flex flex-col gap-1 p-1.5 min-w-0">
            {deadlines.map((d) => (
              <DayDeadlineRow key={d.id} deadline={d} />
            ))}
          </div>
        </div>
      )}

      {/* Hour grid — gutter + one full-width time column. */}
      <div
        className="grid relative flex-1"
        style={{ gridTemplateColumns: "var(--cal-gutter,56px) 1fr" }}
      >
        <div className="border-r border-line">
          {HOURS.map((h) => (
            <div
              key={h}
              className="text-2xs font-mono text-ink-4 text-right pr-1.5 pt-0.5"
              style={{ height: HOUR_HEIGHT_PX }}
            >
              {formatHourLabel(h)}
            </div>
          ))}
        </div>
        <WeekTimeColumn
          day={day}
          isToday={dayKey === todayKey}
          now={now}
          events={timedEvents}
          canEdit={canEditEvents}
          move={moveEvent}
        />
      </div>
    </div>
  );
}

/** Full deadline pill — same kind→color vocabulary as the month
 *  view's DeadlinePill, with room for the matter name inline and
 *  a kind tag on critical/auto-rule deadlines. Links to the
 *  matter's Deadlines tab like every other deadline chip. */
function DayDeadlineRow({ deadline }: { deadline: CalendarDeadlineRow }) {
  const cls =
    deadline.deadlineKind === "critical"
      ? "bg-warn-soft text-warn border-warn-border"
      : deadline.deadlineKind === "auto_rule"
        ? "bg-brand-soft text-brand-700 border-brand-200"
        : "bg-paper-2 text-ink-3 border-line";
  return (
    <Link
      href={`/matters/${deadline.matterId}/deadlines`}
      className={cn(
        "text-2xs font-medium px-2 py-1 rounded border flex items-center gap-1.5 overflow-hidden hover:shadow-sm transition-shadow",
        cls
      )}
      title={`${deadline.title} — ${deadline.matterName}`}
    >
      <span className="shrink-0">⚠</span>
      <span className="truncate">{deadline.title}</span>
      {deadline.deadlineKind === "critical" && (
        <span className="shrink-0 text-3xs font-mono uppercase tracking-wider opacity-80">
          critical
        </span>
      )}
      <span className="ml-auto shrink-0 max-w-[45%] truncate font-mono text-3xs opacity-80">
        {deadline.matterName}
      </span>
    </Link>
  );
}
