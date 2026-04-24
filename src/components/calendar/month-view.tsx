/**
 * Month View
 *
 * Classic 6-row grid. Events and deadlines are shown as compact pills
 * within each day cell; days with more than a few items show a
 * "+N more" tail.
 */

import Link from "next/link";
import {
  addDays,
  format,
  isSameDay,
  isSameMonth,
  startOfDay,
} from "date-fns";
import { cn } from "@/lib/utils";
import { monthGridRange } from "./calendar-toolbar";
import { EventLink } from "./event-link";
import { isWeekend, WEEK_STARTS_ON } from "@/lib/calendar-utils";
import type {
  CalendarItem,
  CalendarEventRow,
  CalendarDeadlineRow,
} from "@/lib/queries/calendar";

const MAX_ITEMS_PER_CELL = 3;

export function MonthView({
  focal,
  items,
}: {
  focal: Date;
  items: CalendarItem[];
}) {
  const { start } = monthGridRange(focal);
  const today = startOfDay(new Date());
  // 6 weeks × 7 days = 42 cells
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));

  const byDay = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const d =
      item.kind === "event"
        ? format(item.startTime, "yyyy-MM-dd")
        : format(item.dueDate, "yyyy-MM-dd");
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(item);
  }
  // Sort items within each day: deadlines first (high-priority visual),
  // then events by start time.
  for (const [, list] of byDay) {
    list.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "deadline" ? -1 : 1;
      if (a.kind === "event" && b.kind === "event") {
        return a.startTime.getTime() - b.startTime.getTime();
      }
      return 0;
    });
  }

  // Order labels so the first column matches WEEK_STARTS_ON.
  const WEEKDAYS_SUN_FIRST = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weekdayLabels =
    WEEK_STARTS_ON === 0
      ? WEEKDAYS_SUN_FIRST
      : [...WEEKDAYS_SUN_FIRST.slice(1), WEEKDAYS_SUN_FIRST[0]];

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-line shrink-0">
        {weekdayLabels.map((w) => {
          const isWeekendLabel = w === "Sat" || w === "Sun";
          return (
            <div
              key={w}
              className={cn(
                "text-2xs font-mono uppercase tracking-wider text-center py-2 border-l border-line first:border-l-0",
                isWeekendLabel ? "text-ink-4/80 bg-paper" : "text-ink-4"
              )}
            >
              {w}
            </div>
          );
        })}
      </div>

      {/* Day grid — 6 rows fill available vertical space */}
      <div className="grid grid-cols-7 flex-1 min-h-0">
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const dayItems = byDay.get(key) ?? [];
          const visible = dayItems.slice(0, MAX_ITEMS_PER_CELL);
          const overflow = dayItems.length - visible.length;
          const isToday = isSameDay(day, today);
          const isInMonth = isSameMonth(day, focal);
          const weekend = isWeekend(day);
          return (
            <div
              key={day.toISOString()}
              className={cn(
                "border-l border-t border-line p-1 min-h-24 flex flex-col gap-1 first:border-l-0",
                !isInMonth
                  ? "bg-paper-2/40"
                  : weekend
                    ? "bg-paper"
                    : "bg-white"
              )}
            >
              <div
                className={cn(
                  "inline-flex items-center justify-center w-5 h-5 rounded-full text-2xs font-mono self-end shrink-0",
                  isToday
                    ? "bg-brand-500 text-white font-semibold"
                    : isInMonth
                      ? "text-ink-2"
                      : "text-ink-4"
                )}
              >
                {format(day, "d")}
              </div>
              <div className="flex flex-col gap-0.5 overflow-hidden">
                {visible.map((item) =>
                  item.kind === "event" ? (
                    <EventPill key={item.id} event={item} />
                  ) : (
                    <DeadlinePill key={item.id} deadline={item} />
                  )
                )}
                {overflow > 0 && (
                  <div className="text-3xs text-ink-4 px-1 font-mono">
                    +{overflow} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventPill({ event }: { event: CalendarEventRow }) {
  return (
    <EventLink eventId={event.id}>
      <div
        className="px-1 py-0.5 rounded-sm text-3xs leading-tight flex items-center gap-1 overflow-hidden hover:bg-brand-tint cursor-pointer"
        style={{
          borderLeft: `2px solid ${event.color}`,
        }}
        title={`${format(event.startTime, "h:mm a")} — ${event.title}${event.matterName ? ` · ${event.matterName}` : ""}`}
      >
        <span className="font-mono text-ink-4 shrink-0">
          {format(event.startTime, "ha").toLowerCase()}
        </span>
        <span className="truncate text-ink">{event.title}</span>
      </div>
    </EventLink>
  );
}

function DeadlinePill({ deadline }: { deadline: CalendarDeadlineRow }) {
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
        "px-1 py-0.5 rounded border text-3xs leading-tight flex items-center gap-1 overflow-hidden",
        cls
      )}
      title={`${deadline.title} — ${deadline.matterName}`}
    >
      <span className="shrink-0">⚠</span>
      <span className="truncate">{deadline.title}</span>
    </Link>
  );
}
