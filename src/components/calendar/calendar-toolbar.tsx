/**
 * Calendar Toolbar
 *
 * Renders above the calendar grid: prev / today / next navigation,
 * view toggle (Day / Week / Month), and range label. Async server
 * component — all state lives in the URL and each control is a
 * `<Link>`; the only data read is the current user's time zone
 * (for "Today").
 */

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import {
  buildCalendarHref,
  calendarDayInTz,
  stepCalendarFocal,
  type CalendarShow,
  type CalendarView,
} from "@/lib/calendar-utils";
import {
  calendarWeekInTz,
  dateKeyInTz,
  formatDateOnly,
} from "@/lib/format-date";
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

/**
 * The toolbar's range label. The days come from the SAME helpers
 * that build the grid (`calendarWeekInTz` / `calendarDayInTz`), so
 * the label can never disagree with the columns on screen — it used
 * to re-derive the week with date-fns and `WEEK_STARTS_ON`, which the
 * grid builders don't honor. Those helpers return noon-UTC Dates;
 * `formatDateOnly` reads them in UTC, so no zone shifts the day.
 */
export function formatRangeLabel(
  view: CalendarView,
  focal: Date,
  tz: string
): string {
  if (view === "day") {
    return formatDateOnly(calendarDayInTz(focal, tz).day, "full_long");
  }
  if (view === "week") {
    const { days } = calendarWeekInTz(focal, tz);
    const start = days[0]!;
    const end = days[6]!;
    if (start.getUTCMonth() === end.getUTCMonth()) {
      return `Week of ${formatDateOnly(start, "medium")}`;
    }
    return `${formatDateOnly(start, "short")} – ${formatDateOnly(end, "medium")}`;
  }
  return calendarDayInTz(focal, tz).day.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

const SHOW_LABEL: Record<CalendarShow, string> = {
  all: "All",
  deadlines: "Deadlines",
};

export async function CalendarToolbar({
  view,
  focal,
  show,
}: {
  view: CalendarView;
  focal: Date;
  /** Active `?show=` filter — every nav link carries it so
   *  stepping weeks / switching views doesn't drop the filter. */
  show: CalendarShow;
}) {
  const userTz = await getCurrentUserTimeZone();
  const today = todayFocalInTz(new Date(), userTz);
  const prev = stepCalendarFocal(view, focal, -1);
  const next = stepCalendarFocal(view, focal, 1);

  return (
    <div className="flex items-center justify-between gap-2 px-3 sm:px-5 py-3 border-b border-line shrink-0">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <div className="flex items-center border border-line rounded-md bg-white">
          <Link
            href={buildCalendarHref(view, focal, { focal: prev }, show)}
            className="p-1.5 text-ink-3 hover:text-brand-700 border-r border-line"
            aria-label={`Previous ${view}`}
          >
            <ChevronLeft size={14} />
          </Link>
          <Link
            href={buildCalendarHref(view, focal, { focal: today }, show)}
            className="px-2.5 h-7 inline-flex items-center text-xs font-medium text-ink-2 hover:text-brand-700 border-r border-line"
          >
            Today
          </Link>
          <Link
            href={buildCalendarHref(view, focal, { focal: next }, show)}
            className="p-1.5 text-ink-3 hover:text-brand-700"
            aria-label={`Next ${view}`}
          >
            <ChevronRight size={14} />
          </Link>
        </div>
        <h2 className="text-sm font-display font-medium text-ink truncate">
          {formatRangeLabel(view, focal, userTz)}
        </h2>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2">
        {/* Item-kind filter — segmented control matching the view
            switcher's idiom. "Deadlines" collapses week/day to the
            deadline strips and strips event pills from month. */}
        <div className="inline-flex items-center rounded-md border border-line bg-white p-0.5">
          {(["all", "deadlines"] as CalendarShow[]).map((s) => {
            const active = s === show;
            return (
              <Link
                key={s}
                href={buildCalendarHref(view, focal, { show: s }, show)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "h-6 px-2.5 rounded text-2xs font-medium transition-colors inline-flex items-center",
                  active
                    ? "bg-brand-soft text-brand-700"
                    : "text-ink-3 hover:text-brand-700"
                )}
              >
                {SHOW_LABEL[s]}
              </Link>
            );
          })}
        </div>

        <div className="inline-flex items-center rounded-md border border-line bg-white p-0.5">
          {(["day", "week", "month"] as CalendarView[]).map((v) => {
            const active = v === view;
            return (
              <Link
                key={v}
                href={buildCalendarHref(view, focal, { view: v }, show)}
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
    </div>
  );
}

// Range computation moved to `calendarWeekInTz` /
// `calendarMonthGridInTz` in src/lib/format-date.ts. The old
// date-fns-based versions used server-local TZ, which silently
// broke for users east/west of UTC (events near local-midnight
// landed on the wrong day). Use the TZ-aware helpers instead.
