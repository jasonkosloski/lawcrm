/**
 * Month View
 *
 * Classic 6-row grid. Events and deadlines are shown as compact pills
 * within each day cell; days with more than a few items show a
 * "+N more" tail.
 */

import Link from "next/link";
import { cn } from "@/lib/utils";
import { EventLink } from "./event-link";
import { WEEK_STARTS_ON } from "@/lib/calendar-utils";
import { dateKeyInTz, formatDate } from "@/lib/format-date";
import type {
  CalendarItem,
  CalendarEventRow,
  CalendarDeadlineRow,
} from "@/lib/queries/calendar";

const MAX_ITEMS_PER_CELL = 3;

export function MonthView({
  focal,
  days,
  items,
  userTz,
}: {
  /** The focal date the user navigated to. Used only to decide
   *  which days are "in this month" vs trailing/leading week
   *  carry-over (rendered dim). */
  focal: Date;
  /** 42 noon-UTC Dates (6 weeks × 7 days) built in user TZ via
   *  `calendarMonthGridInTz`. */
  days: Date[];
  items: CalendarItem[];
  userTz: string;
}) {
  const now = new Date();
  const todayKey = dateKeyInTz(now, userTz);
  // The "in this month" check needs to know which calendar month
  // the focal lives in *in the user's TZ* — same reason as the
  // bucketing below.
  const focalMonth = dateKeyInTz(focal, userTz).slice(0, 7); // "YYYY-MM"

  const byDay = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const itemDate = item.kind === "event" ? item.startTime : item.dueDate;
    const key = dateKeyInTz(itemDate, userTz);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(item);
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
          // Day Dates are noon UTC of the user-TZ calendar day, so
          // `getUTC*` accessors give the right calendar components.
          const key = `${day.getUTCFullYear()}-${String(
            day.getUTCMonth() + 1
          ).padStart(2, "0")}-${String(day.getUTCDate()).padStart(2, "0")}`;
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
                {day.getUTCDate()}
              </div>
              <div className="flex flex-col gap-0.5 overflow-hidden">
                {visible.map((item) =>
                  item.kind === "event" ? (
                    <EventPill key={item.id} event={item} userTz={userTz} />
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
            <div className="truncate font-mono text-ink-4">
              {event.matterName}
            </div>
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
