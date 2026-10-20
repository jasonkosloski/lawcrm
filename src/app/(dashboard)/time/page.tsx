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
 * The live timer shows on TODAY's day view only (it is not part of
 * any other day's total).
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
import { getFirmGoals } from "@/lib/firm";
import { formatHours } from "@/lib/time-entry-constants";
import {
  getMyDayTime,
  getMyRunningTimer,
  getMyWeekTime,
} from "@/lib/queries/time";
import { requireUser } from "@/lib/current-user";

export default async function TimePage({ searchParams }: PageProps<"/time">) {
  await requireUser();
  const sp = await searchParams;
  const userTz = await getCurrentUserTimeZone();
  const { view, focal } = parseTimeParams(sp, userTz);

  if (view === "day") {
    const dayKey = toTimeDateParam(focal);
    // The live timer is today's: on any other day it isn't part of
    // that day's total, so skip the fetch and hide the lane.
    const isToday = dayKey === dateKeyInTz(new Date(), userTz);
    const [day, timer, goals] = await Promise.all([
      getMyDayTime(dayKey),
      isToday ? getMyRunningTimer() : Promise.resolve(null),
      // Daily target for the goal line — firm setting, editable on
      // /settings/firm (was a hardcoded constant).
      getFirmGoals(),
    ]);
    return (
      <>
        <TopBar
          title="Time"
          crumbs={`${formatHours(day.totalHours)}h logged · ${formatHours(day.billableHours)}h billable`}
        />
        <div className="flex-1 flex flex-col min-h-0 animate-page-enter">
          <TimeToolbar view={view} focal={focal} userTz={userTz} />
          <TimeDayView
            day={day}
            timer={timer}
            showTimerLane={isToday}
            asOf={new Date()}
            userTz={userTz}
            dailyHoursGoal={goals.dailyHoursGoal}
          />
        </div>
      </>
    );
  }

  // Week bounds in the user's zone; the 7 day-noon-UTC column
  // dates become the date-only keys the query groups by.
  const week = calendarWeekInTz(focal, userTz);
  const dayKeys = week.days.map(dayKeyFromNoonUtc);
  const [weekTime, goals] = await Promise.all([
    getMyWeekTime(dayKeys),
    getFirmGoals(),
  ]);
  const todayKey = dateKeyInTz(new Date(), userTz);

  return (
    <>
      <TopBar
        title="Time"
        crumbs={`${formatHours(weekTime.totalHours)}h this week · ${formatHours(weekTime.billableHours)}h billable`}
      />
      <div className="flex-1 flex flex-col min-h-0 animate-page-enter">
        <TimeToolbar view={view} focal={focal} userTz={userTz} />
        <TimeWeekView
          week={weekTime}
          todayKey={todayKey}
          dailyHoursGoal={goals.dailyHoursGoal}
        />
      </div>
    </>
  );
}
