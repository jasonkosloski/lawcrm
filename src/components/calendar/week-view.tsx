/**
 * Week View
 *
 * Layout (top to bottom):
 *
 *   1. Sticky day-header row
 *   2. All-day row (uniform height, one cell per day, holds
 *      all-day events + deadlines)
 *   3. Hour grid (gutter on the left + one column per day)
 *
 * Splitting all-day chips into their own row keeps the hour
 * grid's gridlines aligned with the gutter labels exactly. The
 * old design rendered everything inside a single column with a
 * top offset for the bar, which left the gridlines and timed
 * chips out of alignment with the gutter (a 9am chip could
 * appear at the gridline labeled 8:15 if the bar pushed it
 * down). Modeling the all-day strip separately is also how
 * Google / Apple / Outlook calendars do it.
 *
 * Drag-and-drop: when `canEditEvents` is true, each chip is a
 * drag source. The all-day row cells are drop targets for
 * "make all-day on that date"; the time-grid columns are drop
 * targets for "schedule at this time slot." See `event-drag.ts`
 * for the wire format and `week-day-column.tsx` for the per-cell
 * client components.
 *
 * **Optimistic moves.** Move dispatch + the pending-move overlay
 * live in the shared `useEventMoves` hook (also used by DayView):
 * drop / resize fires the server action in a transition AND
 * immediately updates the overlay so the chip jumps to its new
 * spot with zero perceived latency. When the server confirms
 * (router revalidates the page, items prop changes), pending
 * entries the server agrees with are cleared so the chip stays
 * put with no flash. Failure rolls back the overlay and surfaces
 * an error.
 */

"use client";

import Link from "next/link";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  formatHourLabel,
  HOUR_HEIGHT_PX,
  HOURS,
} from "@/lib/calendar-utils";
import { dateKeyInTz } from "@/lib/format-date";
import type {
  CalendarItem,
  CalendarEventRow,
  CalendarDeadlineRow,
} from "@/lib/queries/calendar";
import { WeekAllDayCell, WeekTimeColumn } from "./week-day-column";
import { useEventMoves } from "./use-event-moves";

// `MoveEventFn` moved to use-event-moves.ts when DayView landed;
// re-exported so existing importers keep working.
export type { MoveEventFn } from "./use-event-moves";

export function WeekView({
  days,
  items,
  canEditEvents = false,
  userTz,
}: {
  /** Seven noon-UTC Dates for Sun-Sat of the displayed week, built
   *  in the user's TZ via `calendarWeekInTz`. Noon UTC keeps the
   *  Date's UTC calendar components matching the user's calendar
   *  day so server-side `format()` and client-side render agree. */
  days: Date[];
  items: CalendarItem[];
  /** When true, chips are draggable + day columns expose drop
   *  zones. The server still gates `moveCalendarEvent` on
   *  `events.edit` regardless. */
  canEditEvents?: boolean;
  /** User's IANA TZ — drives event bucketing + the "today"
   *  highlight so a user in MDT viewing on a UTC server still
   *  sees their local day. */
  userTz: string;
}) {
  // Shared optimistic-move pipeline (also used by DayView) —
  // `renderItems` carries the pending overlay so a moved chip
  // lands in its new column / time slot immediately.
  const { renderItems, moveEvent } = useEventMoves(items);

  const now = new Date();
  // "Today" in the user's TZ — used to highlight the right column
  // header. Comparing as a YYYY-MM-DD string avoids any TZ math at
  // the comparison site.
  const todayKey = dateKeyInTz(now, userTz);

  // Bucket items by their user-TZ calendar date. Without the TZ,
  // an event at "Sunday 11pm MDT" (UTC: Monday 5am) would land in
  // the Monday column.
  const byDay = new Map<string, CalendarItem[]>();
  for (const item of renderItems) {
    const itemDate = item.kind === "event" ? item.startTime : item.dueDate;
    const key = dateKeyInTz(itemDate, userTz);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(item);
  }

  // Pre-compute per-day buckets so the all-day row + time grid
  // each pull from the same map without re-filtering. Day keys are
  // derived from the noon-UTC Date's UTC components — that matches
  // what `dateKeyInTz` produced for events on the same calendar
  // day in the user's TZ.
  const byDayBuckets = days.map((day) => {
    const key = `${day.getUTCFullYear()}-${String(
      day.getUTCMonth() + 1
    ).padStart(2, "0")}-${String(day.getUTCDate()).padStart(2, "0")}`;
    const dayItems = byDay.get(key) ?? [];
    return {
      day,
      key,
      allDayEvents: dayItems.filter(
        (i): i is CalendarEventRow => i.kind === "event" && i.isAllDay
      ),
      timedEvents: dayItems.filter(
        (i): i is CalendarEventRow => i.kind === "event" && !i.isAllDay
      ),
      deadlines: dayItems.filter(
        (i): i is CalendarDeadlineRow => i.kind === "deadline"
      ),
    };
  });

  // Uniform all-day-row height across the week so the gridlines
  // below stay flush — even on a day with three chips the row
  // is the same height as a day with zero. Min of 28px gives
  // empty days a real drop target instead of a hairline.
  const maxAllDayChipCount = Math.max(
    1,
    ...byDayBuckets.map(
      (b) => b.allDayEvents.length + b.deadlines.length
    )
  );
  // 28px per chip (two-line all-day or single-line deadline) +
  // 2px gap. Cap to a reasonable max for very full weeks.
  const allDayRowHeight = Math.min(
    180,
    Math.max(36, maxAllDayChipCount * 28 + 8)
  );

  return (
    <div
      // `--cal-gutter` is the width of the left hour-label column.
      // 36px on phones (just enough for "12p"); 56px from sm+ where
      // the calendar has more horizontal room. The grid templates
      // below all read this var.
      className="flex flex-col flex-1 min-h-0 overflow-y-auto [--cal-gutter:36px] sm:[--cal-gutter:56px]"
    >
      {/* Day header row — sticky */}
      <div
        className="grid sticky top-0 z-10 bg-card border-b border-line"
        style={{ gridTemplateColumns: "var(--cal-gutter,56px) repeat(7, 1fr)" }}
      >
        <div />
        {byDayBuckets.map((b) => {
          const day = b.day;
          const dayIsToday = b.key === todayKey;
          // The day Date is noon UTC, so getUTCDay() returns the
          // correct weekday for the user-TZ calendar day this column
          // represents. Avoids re-importing date-fns isSameDay /
          // isWeekend, which use server-local TZ.
          const dow = day.getUTCDay();
          const weekend = dow === 0 || dow === 6;
          return (
            // Whole header cell deep-links to the day's Day view.
            // The href is built from `b.key` directly (not
            // `buildCalendarHref`, whose `toDateParam` formats in
            // the *browser's* TZ — a noon-UTC day Date would come
            // out one day ahead for users east of UTC+11).
            <Link
              key={b.key}
              href={`/calendar?view=day&d=${b.key}`}
              title="Open day view"
              className={cn(
                "flex flex-col items-center gap-0.5 py-2 border-l border-line transition-colors hover:bg-brand-tint/40",
                weekend && "bg-paper"
              )}
            >
              <div
                className={cn(
                  "text-2xs font-mono uppercase tracking-wider",
                  weekend ? "text-ink-4/80" : "text-ink-4"
                )}
              >
                {format(day, "EEE")}
              </div>
              <div
                className={cn(
                  "text-base font-display tracking-tight",
                  dayIsToday
                    ? "text-brand-500 font-semibold"
                    : weekend
                      ? "text-ink-3"
                      : "text-ink"
                )}
              >
                {day.getUTCDate()}
              </div>
            </Link>
          );
        })}
      </div>

      {/* All-day row — sits above the hour grid so the gridlines
          below align with the gutter labels exactly. */}
      <div
        className="grid border-b border-line bg-card"
        style={{
          gridTemplateColumns: "var(--cal-gutter,56px) repeat(7, 1fr)",
          height: allDayRowHeight,
        }}
      >
        <div className="text-2xs font-mono text-ink-4 text-right pr-1.5 pt-1 border-r border-line">
          all-day
        </div>
        {byDayBuckets.map((b) => (
          <WeekAllDayCell
            key={b.key}
            day={b.day}
            events={b.allDayEvents}
            deadlines={b.deadlines}
            canEdit={canEditEvents}
            move={moveEvent}
          />
        ))}
      </div>

      {/* Hour grid */}
      <div
        className="grid relative flex-1"
        style={{ gridTemplateColumns: "var(--cal-gutter,56px) repeat(7, 1fr)" }}
      >
        {/* Hour gutter */}
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

        {/* Per-day time columns. `isToday` is computed in user-TZ
            via the date-key match so the "now line" only shows in
            today's column for the user, not the server. */}
        {byDayBuckets.map((b) => (
          <WeekTimeColumn
            key={b.key}
            day={b.day}
            isToday={b.key === todayKey}
            now={now}
            events={b.timedEvents}
            canEdit={canEditEvents}
            move={moveEvent}
          />
        ))}
      </div>
    </div>
  );
}

// Per-cell rendering lives in `week-day-column.tsx`.
