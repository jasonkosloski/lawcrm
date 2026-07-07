/**
 * Calendar Toolbar
 *
 * Renders above the calendar grid: prev / today / next navigation,
 * view toggle (Week / Month), and range label. Async server component
 * — all state lives in the URL and each control is a `<Link>`; the
 * only data read is the current user's time zone (for "Today").
 */

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  addDays,
  addMonths,
  format,
  parseISO,
  startOfMonth,
  startOfWeek,
  endOfWeek,
  endOfMonth,
} from "date-fns";
import { cn } from "@/lib/utils";
import {
  buildCalendarHref,
  WEEK_STARTS_ON,
  type CalendarView,
} from "@/lib/calendar-utils";
import { dateKeyInTz } from "@/lib/format-date";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";

/**
 * "Today" as a focal Date for the given user time zone.
 *
 * `startOfDay(new Date())` resolves in the *server's* TZ — on a UTC
 * production box a user in America/Denver clicking "Today" between
 * 6pm and midnight local would be sent to tomorrow's date (the same
 * class of bug the range helpers migrated away from; see the note at
 * the bottom of this file). Instead: take the user-local calendar
 * date via `dateKeyInTz`, then parse it back to a Date. `parseISO`
 * on a bare `yyyy-MM-dd` yields server-local midnight of that key,
 * which `toDateParam` round-trips losslessly — the href always
 * carries the user's date regardless of server TZ.
 */
export function todayFocalInTz(now: Date, tz: string): Date {
  return parseISO(dateKeyInTz(now, tz));
}

function formatRangeLabel(view: CalendarView, focal: Date): string {
  if (view === "week") {
    const start = startOfWeek(focal, { weekStartsOn: WEEK_STARTS_ON });
    const end = endOfWeek(focal, { weekStartsOn: WEEK_STARTS_ON });
    if (start.getMonth() === end.getMonth()) {
      return `Week of ${format(start, "MMM d, yyyy")}`;
    }
    return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
  }
  return format(focal, "MMMM yyyy");
}

export async function CalendarToolbar({
  view,
  focal,
}: {
  view: CalendarView;
  focal: Date;
}) {
  const userTz = await getCurrentUserTimeZone();
  const today = todayFocalInTz(new Date(), userTz);
  const prev =
    view === "week"
      ? addDays(focal, -7)
      : addMonths(startOfMonth(focal), -1);
  const next =
    view === "week"
      ? addDays(focal, 7)
      : addMonths(startOfMonth(focal), 1);

  return (
    <div className="flex items-center justify-between gap-2 px-3 sm:px-5 py-3 border-b border-line shrink-0">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <div className="flex items-center border border-line rounded-md bg-white">
          <Link
            href={buildCalendarHref(view, focal, { focal: prev })}
            className="p-1.5 text-ink-3 hover:text-brand-700 border-r border-line"
            aria-label={view === "week" ? "Previous week" : "Previous month"}
          >
            <ChevronLeft size={14} />
          </Link>
          <Link
            href={buildCalendarHref(view, focal, { focal: today })}
            className="px-2.5 h-7 inline-flex items-center text-xs font-medium text-ink-2 hover:text-brand-700 border-r border-line"
          >
            Today
          </Link>
          <Link
            href={buildCalendarHref(view, focal, { focal: next })}
            className="p-1.5 text-ink-3 hover:text-brand-700"
            aria-label={view === "week" ? "Next week" : "Next month"}
          >
            <ChevronRight size={14} />
          </Link>
        </div>
        <h2 className="text-sm font-display font-medium text-ink truncate">
          {formatRangeLabel(view, focal)}
        </h2>
      </div>

      <div className="inline-flex items-center rounded-md border border-line bg-white p-0.5">
        {(["week", "month"] as CalendarView[]).map((v) => {
          const active = v === view;
          return (
            <Link
              key={v}
              href={buildCalendarHref(view, focal, { view: v })}
              className={cn(
                "h-6 px-2.5 rounded text-2xs font-medium capitalize transition-colors",
                active
                  ? "bg-brand-soft text-brand-700"
                  : "text-ink-3 hover:text-brand-700"
              )}
            >
              {v}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// Range computation moved to `calendarWeekInTz` /
// `calendarMonthGridInTz` in src/lib/format-date.ts. The old
// date-fns-based versions used server-local TZ, which silently
// broke for users east/west of UTC (events near local-midnight
// landed on the wrong day). Use the TZ-aware helpers instead.
