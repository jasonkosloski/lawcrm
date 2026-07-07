/**
 * Time Page — standalone time-tracking views
 *
 * Week view (default) and Day / reconciliation view, URL-driven
 * like the calendar: `?view=week|day` + `?d=YYYY-MM-DD`.
 *
 *  - Week: one row per day of the viewer's week, horizontal hour
 *    bars segmented per matter, day totals, billable vs
 *    non-billable, week running totals.
 *  - Day: three reconciliation lanes — Logged (manual entries),
 *    Captured (source !== "manual"), Timer (live TimerSession,
 *    read-only) — plus the day total vs the daily target line.
 *
 * READ-ONLY v1: no inline entry creation or editing here — every
 * entry links to its matter's Time tab, which owns the composer
 * and row actions. The timer widget owns timer interaction.
 *
 * Current user only: both views read the viewer's own entries. A
 * user picker for admins/managers ("show me an associate's week")
 * is a deliberate future extension — it needs its own permission
 * key before anyone else's hours become visible here.
 *
 * TZ: the focal date defaults to "today" on the USER's calendar
 * (getCurrentUserTimeZone + the date-key round-trip), and the week
 * is built in the user's zone via calendarWeekInTz. TimeEntry.date
 * is a date-only column, so day keys — not instants — cross into
 * the queries (see src/lib/queries/time.ts).
 */

import { TopBar } from "@/components/layout/topbar";
import { TimeToolbar } from "@/components/time-views/time-toolbar";
import { TimeWeekView } from "@/components/time-views/time-week-view";
import { TimeDayView } from "@/components/time-views/time-day-view";
import {
  dayKeyFromNoonUtc,
  parseTimeParams,
  toTimeDateParam,
} from "@/components/time-views/time-view-utils";
import { calendarWeekInTz, dateKeyInTz } from "@/lib/format-date";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import {
  getMyDayTime,
  getMyRunningTimer,
  getMyWeekTime,
} from "@/lib/queries/time";

export default async function TimePage({ searchParams }: PageProps<"/time">) {
  const sp = await searchParams;
  const userTz = await getCurrentUserTimeZone();
  const { view, focal } = parseTimeParams(sp, userTz);

  if (view === "day") {
    const dayKey = toTimeDateParam(focal);
    const [day, timer] = await Promise.all([
      getMyDayTime(dayKey),
      getMyRunningTimer(),
    ]);
    return (
      <>
        <TopBar
          title="Time"
          crumbs={`${day.totalHours.toFixed(1)}h logged · ${day.billableHours.toFixed(1)}h billable`}
        />
        <div className="flex-1 flex flex-col min-h-0 animate-page-enter">
          <TimeToolbar view={view} focal={focal} />
          <TimeDayView day={day} timer={timer} userTz={userTz} />
        </div>
      </>
    );
  }

  // Week bounds in the user's zone; the 7 day-noon-UTC column
  // dates become the date-only keys the query groups by.
  const week = calendarWeekInTz(focal, userTz);
  const dayKeys = week.days.map(dayKeyFromNoonUtc);
  const weekTime = await getMyWeekTime(dayKeys);
  const todayKey = dateKeyInTz(new Date(), userTz);

  return (
    <>
      <TopBar
        title="Time"
        crumbs={`${weekTime.totalHours.toFixed(1)}h this week · ${weekTime.billableHours.toFixed(1)}h billable`}
      />
      <div className="flex-1 flex flex-col min-h-0 animate-page-enter">
        <TimeToolbar view={view} focal={focal} />
        <TimeWeekView week={weekTime} todayKey={todayKey} />
      </div>
    </>
  );
}
