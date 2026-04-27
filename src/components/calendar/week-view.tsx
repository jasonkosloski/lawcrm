/**
 * Week View
 *
 * 7 day columns + a left-rail time gutter. Events are positioned
 * absolutely within their day column based on start/end times.
 * Deadlines (time-less) float above the hour grid as a bar at the
 * top of their day.
 *
 * Hour range is fixed at 6am–9pm (HOURS in calendar-utils) — legal
 * work hours fit comfortably inside without scrolling.
 *
 * Drag-and-drop: when `canEditEvents` is true, each chip is a
 * drag source and each day exposes two drop zones (all-day bar
 * + hour grid). Per-column DnD logic lives in the client
 * `WeekDayColumn` component so this server component stays a
 * thin layout wrapper. See `event-drag.ts` for the wire format.
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
import { WeekDayColumn } from "./week-day-column";

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

      {/* Time grid */}
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

        {/* Day columns — delegated to the client WeekDayColumn so
            the drag-and-drop logic stays in one place. */}
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const dayItems = byDay.get(key) ?? [];
          const allDayEvents = dayItems.filter(
            (i): i is CalendarEventRow => i.kind === "event" && i.isAllDay
          );
          const timedEvents = dayItems.filter(
            (i): i is CalendarEventRow => i.kind === "event" && !i.isAllDay
          );
          const deadlines = dayItems.filter(
            (i): i is CalendarDeadlineRow => i.kind === "deadline"
          );
          return (
            <WeekDayColumn
              key={day.toISOString()}
              day={day}
              today={today}
              now={now}
              allDayEvents={allDayEvents}
              timedEvents={timedEvents}
              deadlines={deadlines}
              canEdit={canEditEvents}
            />
          );
        })}
      </div>
    </div>
  );
}

// All chip + drop-zone rendering lives in `WeekDayColumn` now.
