/**
 * Month View
 *
 * Classic 6-row grid. Events and deadlines are shown as compact pills
 * within each day cell; days with more than a few items show a
 * "+N more" tail.
 */

import { CalendarClock } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { EventLink } from "./event-link";
import { dateKeyInTz, dateOnlyKey, formatDate } from "@/lib/format-date";
import type { CalendarItem, CalendarEventRow, CalendarDeadlineRow } from "@/lib/queries/calendar";
import { bucketItemsByDay, weekdayShort } from "./bucket-items";

const MAX_ITEMS_PER_CELL = 3;

export function MonthView({
  focalKey,
  days,
  items,
  userTz,
}: {
  /** The focal date the user navigated to, as `YYYY-MM-DD`, computed
   *  by the page from the same `?d=` the grid was built from. Used
   *  only to decide which days are "in this month" vs trailing /
   *  leading week carry-over (rendered dim). A string, not a Date:
   *  re-deriving the month from a Date through the viewer's zone put
   *  a focal on the 1st (every Next/Prev click) in the previous
   *  month. */
  focalKey: string;
  /** 42 noon-UTC Dates (6 weeks × 7 days) built in user TZ via
   *  `calendarMonthGridInTz`. */
  days: Date[];
  items: CalendarItem[];
  userTz: string;
}) {
  const now = new Date();
  const todayKey = dateKeyInTz(now, userTz);
  const focalMonth = focalKey.slice(0, 7); // "YYYY-MM"

  // Bucket by calendar day: timed events in the viewer's zone,
  // deadlines and all-day events as date-only values in UTC (ADR-012).
  const byDay = bucketItemsByDay(items, userTz);
  // Sort items within each day: deadlines first (high-priority visual),
  // then all-day events, then timed events by start time.
  for (const [, list] of byDay) {
    list.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "deadline" ? -1 : 1;
      if (a.kind === "event" && b.kind === "event") {
        if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1;
        return a.startTime.getTime() - b.startTime.getTime();
      }
      return 0;
    });
  }

  // Weekday labels come from the grid's own first row, so the header
  // can never disagree with the columns the grid builder laid out.
  const weekdayLabels = days.slice(0, 7).map(weekdayShort);

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
                "text-2xs font-mono text-center py-2 border-l border-line first:border-l-0",
                isWeekendLabel ? "text-ink-4/80 bg-paper" : "text-ink-4",
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
          // Day Dates are noon UTC of the calendar day, so UTC
          // accessors give the right calendar components.
          const key = dateOnlyKey(day);
          const dayItems = byDay.get(key) ?? [];
          const visible = dayItems.slice(0, MAX_ITEMS_PER_CELL);
          const overflow = dayItems.length - visible.length;
          const isToday = key === todayKey;
          const isInMonth = key.slice(0, 7) === focalMonth;
          const dow = day.getUTCDay();
          const weekend = dow === 0 || dow === 6;
          return (
            <div
              key={key}
              className={cn(
                "border-l border-t border-line p-1 min-h-24 flex flex-col gap-1 first:border-l-0",
                !isInMonth ? "bg-paper-2/40" : weekend ? "bg-paper" : "bg-white",
              )}
            >
              {/* Day number deep-links to the day's Day view. The
                  href reuses the cell's already-computed user-TZ
                  date key rather than formatting the Date again. */}
              <Link
                href={`/calendar?view=day&d=${key}`}
                title="Open day view"
                className={cn(
                  "inline-flex items-center justify-center w-5 h-5 rounded-full text-2xs font-mono self-end shrink-0 transition-colors",
                  isToday
                    ? "bg-brand-700 text-white font-semibold hover:bg-brand-900"
                    : isInMonth
                      ? "text-ink-2 hover:bg-brand-tint hover:text-brand-700"
                      : "text-ink-4 hover:bg-brand-tint hover:text-brand-700",
                )}
              >
                {day.getUTCDate()}
              </Link>
              <div className="flex flex-col gap-0.5 overflow-hidden">
                {visible.map((item) =>
                  item.kind === "event" ? (
                    <EventPill key={item.id} event={item} userTz={userTz} />
                  ) : (
                    <DeadlinePill key={item.id} deadline={item} />
                  ),
                )}
                {overflow > 0 && (
                  <div className="text-3xs text-ink-4 px-1 font-mono">+{overflow} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Compact hour label for a timed pill — "9am", "12pm". Minutes are
 * deliberately dropped to keep the pill on one line; the tooltip
 * carries the full time.
 *
 * Must be anchored to the *user's* TZ: this renders on the server,
 * where the runtime's local zone is UTC in production, so a
 * TZ-naive formatter (date-fns `format`) would label a 9am Denver
 * event "3pm" even though the bucketing above already placed it in
 * the right day cell. Exported for tests.
 */
export function compactHourInTz(d: Date, tz: string): string {
  return d
    .toLocaleString("en-US", { hour: "numeric", timeZone: tz })
    .replace(/\s+/g, "") // "9 AM" → "9AM" (ICU may emit U+202F)
    .toLowerCase();
}

function EventPill({
  event,
  userTz,
}: {
  event: CalendarEventRow;
  /** User's IANA TZ — time labels must render in it, not the server's. */
  userTz: string;
}) {
  // All-day pills get a filled background and two-line layout
  // (title + matter name) for at-a-glance scoping; timed pills
  // keep the single-line "9am — Title" treatment with a hairline
  // left-rule.
  const isAllDay = event.isAllDay;
  if (isAllDay) {
    return (
      <EventLink eventId={event.id}>
        <div
          className="px-1 py-0.5 rounded-sm text-3xs leading-tight overflow-hidden hover:bg-brand-tint cursor-pointer"
          style={{
            background: `color-mix(in oklch, ${event.color} 16%, white)`,
            borderLeft: `2px solid ${event.color}`,
          }}
          title={`All day: ${event.title}${event.matterName ? ` · ${event.matterName}` : ""}`}
        >
          <div className="truncate text-ink">All day: {event.title}</div>
          {event.matterName && (
            <div className="truncate font-mono text-ink-4">{event.matterName}</div>
          )}
        </div>
      </EventLink>
    );
  }
  return (
    <EventLink eventId={event.id}>
      <div
        className="px-1 py-0.5 rounded-sm text-3xs leading-tight flex items-center gap-1 overflow-hidden hover:bg-brand-tint cursor-pointer"
        style={{ borderLeft: `2px solid ${event.color}` }}
        title={`${formatDate(event.startTime, "time", userTz)} — ${event.title}${event.matterName ? ` · ${event.matterName}` : ""}`}
      >
        <span className="font-mono text-ink-4 shrink-0">
          {compactHourInTz(event.startTime, userTz)}
        </span>
        <span className="truncate text-ink">{event.title}</span>
      </div>
    </EventLink>
  );
}

function DeadlinePill({ deadline }: { deadline: CalendarDeadlineRow }) {
  const cls =
    deadline.deadlineKind === "critical"
      ? "bg-danger-soft text-danger border-danger/30"
      : "bg-white text-ink-2 border-warn/40";
  const critical = deadline.deadlineKind === "critical";
  return (
    <Link
      href={`/matters/${deadline.matterId}/deadlines`}
      className={cn(
        "px-1 py-0.5 rounded border text-3xs leading-tight flex items-center gap-1 overflow-hidden",
        cls,
      )}
      title={`${deadline.title} — ${deadline.matterName}`}
    >
      <CalendarClock
        size={11}
        strokeWidth={2}
        aria-label="Due"
        className={cn("shrink-0", critical ? "text-danger" : "text-warn")}
      />
      <span className="truncate">{deadline.title}</span>
    </Link>
  );
}
