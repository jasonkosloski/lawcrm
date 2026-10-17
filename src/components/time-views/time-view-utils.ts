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

import { format, isValid, parseISO, startOfDay } from "date-fns";
import { dateKeyInTz, dateOnlyKey } from "@/lib/format-date";
import {
  TIME_ENTRY_SOURCE_LABEL,
  timeEntrySourceLabel,
} from "@/lib/time-entry-constants";

export type TimeView = "week" | "day";
export const DEFAULT_TIME_VIEW: TimeView = "week";

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
    // parseISO never throws - an impossible date (2026-02-31,
    // 2026-13-01) comes back as an Invalid Date that would blow up
    // `format()` later and 500 the page. Fall back to today instead.
    const parsed = parseISO(rawDate);
    focal = isValid(parsed) ? startOfDay(parsed) : todayFocal();
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
 * `calendarWeekInTz` returns for its 7 columns). Read with UTC
 * getters (`dateOnlyKey`): the column dates are built on UTC noon,
 * so this is exact in every server zone.
 */
export const dayKeyFromNoonUtc = (d: Date): string => dateOnlyKey(d);

/** Human label for a TimeEntry.source value on the Captured lane
 *  (one shared map - see TIME_ENTRY_SOURCE_LABEL). */
export const TIME_SOURCE_LABEL: Record<string, string> =
  TIME_ENTRY_SOURCE_LABEL;

export const timeSourceLabel = (source: string): string =>
  timeEntrySourceLabel(source);
