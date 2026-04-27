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
 */

import { addDays, format, isSameDay, startOfDay } from "date-fns";
import { cn } from "@/lib/utils";
import {
  formatHourLabel,
  HOUR_HEIGHT_PX,
  HOURS,
  isWeekend,
} from "@/lib/calendar-utils";
import type {
  CalendarItem,
  CalendarEventRow,
  CalendarDeadlineRow,
} from "@/lib/queries/calendar";
import { weekRange } from "./calendar-toolbar";
import { WeekAllDayCell, WeekTimeColumn } from "./week-day-column";

export function WeekView({
  focal,
  items,
  canEditEvents = false,
}: {
  focal: Date;
  items: CalendarItem[];
  /** When true, chips are draggable + day columns expose drop
   *  zones. The server still gates `moveCalendarEvent` on
   *  `events.edit` regardless. */
  canEditEvents?: boolean;
}) {
  const { start } = weekRange(focal);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const today = startOfDay(new Date());
  const now = new Date();

  // Pre-bucket items by day (YYYY-MM-DD key).
  const byDay = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const d =
      item.kind === "event"
        ? format(item.startTime, "yyyy-MM-dd")
        : format(item.dueDate, "yyyy-MM-dd");
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(item);
  }

  // Pre-compute per-day buckets so the all-day row + time grid
  // each pull from the same map without re-filtering.
  const byDayBuckets = days.map((day) => {
    const key = format(day, "yyyy-MM-dd");
    const items = byDay.get(key) ?? [];
    return {
      day,
      key,
      allDayEvents: items.filter(
        (i): i is CalendarEventRow => i.kind === "event" && i.isAllDay
      ),
      timedEvents: items.filter(
        (i): i is CalendarEventRow => i.kind === "event" && !i.isAllDay
      ),
      deadlines: items.filter(
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
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      {/* Day header row — sticky */}
      <div
        className="grid sticky top-0 z-10 bg-card border-b border-line"
        style={{ gridTemplateColumns: "56px repeat(7, 1fr)" }}
      >
        <div />
        {days.map((day) => {
          const dayIsToday = isSameDay(day, today);
          const weekend = isWeekend(day);
          return (
            <div
              key={day.toISOString()}
              className={cn(
                "flex flex-col items-center gap-0.5 py-2 border-l border-line",
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
                {format(day, "d")}
              </div>
            </div>
          );
        })}
      </div>

      {/* All-day row — sits above the hour grid so the gridlines
          below align with the gutter labels exactly. */}
      <div
        className="grid border-b border-line bg-card"
        style={{
          gridTemplateColumns: "56px repeat(7, 1fr)",
          height: allDayRowHeight,
        }}
      >
        <div className="text-2xs font-mono text-ink-4 text-right pr-1.5 pt-1 border-r border-line">
          all-day
        </div>
        {byDayBuckets.map((b) => (
          <WeekAllDayCell
            key={b.day.toISOString()}
            day={b.day}
            events={b.allDayEvents}
            deadlines={b.deadlines}
            canEdit={canEditEvents}
          />
        ))}
      </div>

      {/* Hour grid */}
      <div
        className="grid relative flex-1"
        style={{ gridTemplateColumns: "56px repeat(7, 1fr)" }}
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

        {/* Per-day time columns */}
        {byDayBuckets.map((b) => (
          <WeekTimeColumn
            key={b.day.toISOString()}
            day={b.day}
            today={today}
            now={now}
            events={b.timedEvents}
            canEdit={canEditEvents}
          />
        ))}
      </div>
    </div>
  );
}

// Per-cell rendering lives in `week-day-column.tsx`.
