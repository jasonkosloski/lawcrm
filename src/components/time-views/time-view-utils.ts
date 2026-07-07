/**
 * Time-views URL helpers
 *
 * The standalone /time page is URL-driven exactly like the calendar:
 * `?view=week|day` + `?d=YYYY-MM-DD`. These are the time-page
 * siblings of `parseCalendarParams` / `buildCalendarHref` in
 * src/lib/calendar-utils.ts — separate functions (not a shared
 * generic) because the two pages own different view vocabularies
 * and default views, and coupling them made both harder to read.
 *
 * Pure helpers only — no DB, no async. The viewer's IANA zone is
 * threaded in by the page (via getCurrentUserTimeZone) so the
 * default focal on first load is "today" on the USER's calendar,
 * not the server's.
 */

import { format, parseISO, startOfDay } from "date-fns";
import { dateKeyInTz } from "@/lib/format-date";

export type TimeView = "week" | "day";
export const DEFAULT_TIME_VIEW: TimeView = "week";

/**
 * Daily hours target rendered as the goal line on the day view.
 *
 * Duplicated from the hardcoded `hoursGoal: 6.0` in
 * `getDashboardKpis` (src/lib/queries/dashboard.ts). Both copies
 * are placeholders for a per-firm setting — when a FirmSettings
 * model lands, resolve the goal there and delete both constants.
 */
export const DAILY_HOURS_GOAL = 6.0;

/**
 * Parse `?view=` / `?d=` into time-page state.
 *
 * `tz` is required for the no-`?d=` default: take the user-local
 * calendar date key via `dateKeyInTz`, parse it back to
 * server-local midnight (the date-key round-trip the calendar
 * established) so a Denver user loading /time at 8pm local on a
 * UTC box lands on their today, not tomorrow.
 *
 * `now` is injectable for tests only.
 */
export function parseTimeParams(
  sp: Record<string, string | string[] | undefined>,
  tz: string,
  now: Date = new Date()
): { view: TimeView; focal: Date } {
  const rawView = Array.isArray(sp.view) ? sp.view[0] : sp.view;
  const view: TimeView =
    rawView === "week" || rawView === "day" ? rawView : DEFAULT_TIME_VIEW;

  const todayFocal = () => parseISO(dateKeyInTz(now, tz));

  const rawDate = Array.isArray(sp.d) ? sp.d[0] : sp.d;
  let focal: Date;
  if (rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    try {
      focal = startOfDay(parseISO(rawDate));
    } catch {
      focal = todayFocal();
    }
  } else {
    focal = todayFocal();
  }
  return { view, focal };
}

/** Serialize a focal Date back to the `?d=` wire format. */
export const toTimeDateParam = (d: Date): string => format(d, "yyyy-MM-dd");

/** Build an href for the time page with new view/date values. */
export function buildTimeHref(
  view: TimeView,
  focal: Date,
  override: { view?: TimeView; focal?: Date } = {}
): string {
  const v = override.view ?? view;
  const d = override.focal ?? focal;
  const params = new URLSearchParams();
  if (v !== DEFAULT_TIME_VIEW) params.set("view", v);
  params.set("d", toTimeDateParam(d));
  return `/time?${params.toString()}`;
}

/**
 * "YYYY-MM-DD" key for a day-noon-UTC Date (the shape
 * `calendarWeekInTz` returns for its 7 columns). Server-local
 * formatting is safe here because noon UTC is the same calendar
 * day in every zone from UTC-12 to UTC+11 — the same trick the
 * calendar's day columns rely on.
 */
export const dayKeyFromNoonUtc = (d: Date): string => format(d, "yyyy-MM-dd");

/** Human label for a TimeEntry.source value on the Captured lane. */
export const TIME_SOURCE_LABEL: Record<string, string> = {
  timer: "Timer",
  email: "Email",
  calendar: "Calendar",
  document: "Document",
  task: "Task",
  evidence: "Evidence",
};

export const timeSourceLabel = (source: string): string =>
  TIME_SOURCE_LABEL[source] ?? source;
