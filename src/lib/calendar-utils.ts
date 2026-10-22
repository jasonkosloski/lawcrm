/**
 * Calendar URL helpers
 *
 * Parses and serializes the `?view=`, `?d=`, and `?show=` params the
 * calendar page uses for state. All date arithmetic goes through
 * `date-fns`.
 */

import { addDays, addMonths, format, isValid, parseISO, startOfDay, startOfMonth } from "date-fns";
import {
  addDaysToKey,
  dateKeyInTz,
  dateOnlyKey,
  instantInTz,
  toWallClockInput,
  type DayKey,
} from "@/lib/format-date";

export type CalendarView = "week" | "month" | "day";
export const DEFAULT_VIEW: CalendarView = "week";

/**
 * Item-kind filter: `all` (default) mixes events + deadlines the way
 * the calendar always has; `deadlines` hides events so the calendar
 * reads as a pure docket view. URL-driven (`?show=deadlines`) like
 * view/date so it survives refresh, sharing, and back-button.
 */
export type CalendarShow = "all" | "deadlines";
export const DEFAULT_SHOW: CalendarShow = "all";

/**
 * Apply the `?show=` filter to a fetched item list. The fetch stays a
 * single `getCalendarItems` call regardless of the filter (events +
 * deadlines come back interleaved from one round-trip); filtering
 * happens at render. Structurally typed on `kind` so the client-safe
 * utils module doesn't import the server query module's row types.
 */
export function filterCalendarItems<T extends { kind: "event" | "deadline" }>(
  items: readonly T[],
  show: CalendarShow,
): T[] {
  if (show === "deadlines") return items.filter((i) => i.kind === "deadline");
  return [...items];
}

/**
 * First day of the week.
 *
 * 0 = Sunday (US convention), 1 = Monday (European / ISO convention).
 * Currently a module-level constant — when the `UserPreferences` model
 * lands, this will become a per-user setting resolved via the current
 * user context.
 *
 * NOT yet a single edit: the range helpers `calendarWeekInTz` and
 * `calendarMonthGridInTz` (format-date.ts) hard-code a Sunday start, so
 * flipping this alone would put Monday-first header labels over
 * Sunday-first query ranges and day columns. Thread it through those
 * helpers (and the views that build their own header rows) first.
 */
export const WEEK_STARTS_ON: 0 | 1 = 0;

/** True if the given calendar day falls on Saturday or Sunday. Used to
 *  give weekend cells/columns a subtle warm tint in the calendar views.
 *  Takes the views' day convention — noon UTC of the calendar day
 *  (`calendarWeekInTz().days`) — and reads its UTC weekday, so the
 *  answer is the same on the server and in any browser zone. */
export function isWeekend(date: Date): boolean {
  const d = date.getUTCDay();
  return d === 0 || d === 6;
}

/**
 * Parse `?view=` / `?d=` / `?show=` into calendar state.
 *
 * `tz` (the viewer's IANA zone) is required because the default focal
 * — first load without `?d=` — must be "today" on the *user's*
 * calendar, not the server's. `startOfDay(new Date())` resolves in
 * server TZ: on a UTC production box a Denver user loading /calendar
 * between 6pm and midnight local landed on tomorrow's week. Same bug
 * class the toolbar's "Today" link already fixed (`todayFocalInTz` in
 * calendar-toolbar.tsx) — take the user-local date key via
 * `dateKeyInTz`, parse it back to a server-local-midnight Date, which
 * `toDateParam` round-trips losslessly.
 *
 * `now` is injectable for tests only.
 */
export function parseCalendarParams(
  sp: Record<string, string | string[] | undefined>,
  tz: string,
  now: Date = new Date(),
): { view: CalendarView; focal: Date; show: CalendarShow } {
  const rawView = Array.isArray(sp.view) ? sp.view[0] : sp.view;
  const view: CalendarView =
    rawView === "week" || rawView === "month" || rawView === "day" ? rawView : DEFAULT_VIEW;

  // Only the exact value "deadlines" flips the filter — anything
  // else (missing, garbage, tampered) falls back to the default so
  // a bad URL never blanks the calendar.
  const rawShow = Array.isArray(sp.show) ? sp.show[0] : sp.show;
  const show: CalendarShow = rawShow === "deadlines" ? "deadlines" : DEFAULT_SHOW;

  const todayFocal = () => parseISO(dateKeyInTz(now, tz));

  const rawDate = Array.isArray(sp.d) ? sp.d[0] : sp.d;
  let focal: Date;
  if (rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    // parseISO returns an Invalid Date (it doesn't throw) for an
    // impossible day like 2026-02-30 or month 13; passing that on
    // crashes every range helper downstream, so fall back to today.
    const parsed = parseISO(rawDate);
    focal = isValid(parsed) ? startOfDay(parsed) : todayFocal();
  } else {
    focal = todayFocal();
  }
  return { view, focal, show };
}

export const toDateParam = (d: Date): string => format(d, "yyyy-MM-dd");

/**
 * Build an href for the calendar page with new view/date/show values.
 *
 * `show` is a trailing param (defaulting to `all`) so pre-filter
 * callers and tests keep working unchanged; like `view`, the default
 * value is dropped from the URL for a cleaner address bar. The
 * round-trip contract: any state this emits, `parseCalendarParams`
 * reads back losslessly.
 */
export function buildCalendarHref(
  view: CalendarView,
  focal: Date,
  override: { view?: CalendarView; focal?: Date; show?: CalendarShow } = {},
  show: CalendarShow = DEFAULT_SHOW,
): string {
  const v = override.view ?? view;
  const d = override.focal ?? focal;
  const s = override.show ?? show;
  const params = new URLSearchParams();
  if (v !== DEFAULT_VIEW) params.set("view", v);
  params.set("d", toDateParam(d));
  if (s !== DEFAULT_SHOW) params.set("show", s);
  return `/calendar?${params.toString()}`;
}

/**
 * Compute the single-day range for `focal` in the given TZ —
 * day-view sibling of `calendarWeekInTz` / `calendarMonthGridInTz`
 * (format-date.ts). Lives here rather than there because the day
 * key comes from the focal's own calendar components
 * (`toDateParam`), NOT from re-interpreting the instant through
 * the TZ: focal Dates are server-local midnights that losslessly
 * encode the URL's `?d=` key (see `parseCalendarParams`). Running
 * the instant through `dateKeyInTz` shifts users west of the
 * server back one day — mostly invisible in week view (usually
 * the same week) but ALWAYS wrong in day view.
 *
 * Returns:
 *   - `day`: noon-UTC Date of the calendar day (same convention
 *     as the week/month `days` arrays — UTC accessors yield the
 *     user-calendar components on any server/browser TZ).
 *   - `rangeStart` / `rangeEnd`: UTC instants of 00:00 and 23:59
 *     wall-clock in `tz` — what the DB query needs. DST days
 *     (23h / 25h) fall out of `instantInTz` for free.
 */
export function calendarDayInTz(
  focal: Date,
  tz: string,
): { day: Date; rangeStart: Date; rangeEnd: Date } {
  const [y, m, d] = toDateParam(focal).split("-").map(Number) as [number, number, number];
  return {
    day: new Date(Date.UTC(y, m - 1, d, 12)),
    rangeStart: instantInTz(y, m, d, 0, 0, tz),
    rangeEnd: instantInTz(y, m, d, 23, 59, tz),
  };
}

/**
 * Prev/next focal for the toolbar arrows: ±1 day in day view,
 * ±7 days in week view, ±1 month (anchored to the 1st) in month
 * view. Calendar-day arithmetic via date-fns — a step never lands
 * mid-day, so `toDateParam` round-trips it losslessly across DST
 * transitions and month/year boundaries.
 */
export function stepCalendarFocal(view: CalendarView, focal: Date, dir: 1 | -1): Date {
  if (view === "day") return addDays(focal, dir);
  if (view === "week") return addDays(focal, 7 * dir);
  return addMonths(startOfMonth(focal), dir);
}

/** Whole-hour labels used in week view, 6am → 9pm inclusive. */
export const HOURS = Array.from({ length: 16 }, (_, i) => i + 6); // 6..21

export const HOUR_HEIGHT_PX = 48;

/** Format an hour (0-23) as "8a" / "12p" / "5p". */
export function formatHourLabel(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour < 12 || hour === 24 ? "a" : "p";
  return `${h12}${suffix}`;
}

/** Hour-of-day (fractional) of an instant: in `tz` when given, else in
 *  the runtime's zone. Pass `tz` — the runtime zone differs between the
 *  UTC server render and the browser, so a tz-less chip is positioned
 *  differently on each (and a 9:00 MDT event lands in the 3 pm slot on
 *  the server). */
// ── Overlap layout ─────────────────────────────────────────────────────
//
// When timed events overlap on the same day, the standard calendar
// behavior (Google / Apple / Outlook) is to split the column
// horizontally — N overlapping events each get 1/N of the width
// and sit side-by-side. Non-overlapping events stay full-width
// regardless of what's happening elsewhere in the day.
//
// The algorithm is two passes:
//
//   1. Sweep-line clustering. Walk events in start-time order. A
//      new cluster begins the moment the next event's start is
//      ≥ the running max-end of the current cluster — i.e. the
//      gap is real and the layout decisions don't have to chain
//      across it.
//
//   2. Greedy lane assignment per cluster. Each event picks the
//      lowest-numbered lane whose previous occupant has ended by
//      the new event's start. The cluster's lane count is the
//      max lane index used + 1; that count drives the per-event
//      width = 100% / count.
//
// The output keeps each event's natural width when it has no
// overlap (cluster of one → laneCount=1), and shrinks only the
// events that actually conflict.

/** A single timed event in the form the layout helper consumes.
 *  We only care about start + end; the caller threads its own
 *  identity / metadata through the result. */
export type LayoutInput = { start: Date; end: Date };

/** Result of the layout algorithm. `lane` is 0-indexed within
 *  the event's cluster; `laneCount` is that cluster's total
 *  lane count. Together they determine the chip's horizontal
 *  position: `left = lane / laneCount`, `width = 1 / laneCount`. */
export type LayoutResult<T> = {
  event: T;
  lane: number;
  laneCount: number;
};

/** Compute lane assignments for a day's timed events.
 *
 *  Order of input doesn't matter — the helper sorts internally.
 *  Order of output matches the sorted order so the caller can
 *  iterate without re-sorting.
 *
 *  Two events touching at the boundary (A.end === B.start) do
 *  NOT overlap — the second event reuses the first's lane and a
 *  new cluster may begin if no other event bridges the gap.
 */
export function layoutOverlappingEvents<T extends LayoutInput>(
  events: readonly T[],
): LayoutResult<T>[] {
  if (events.length === 0) return [];
  const sorted = [...events].sort((a, b) => a.start.getTime() - b.start.getTime());

  const result: LayoutResult<T>[] = [];

  // Walk clusters one at a time. `cluster` accumulates events
  // until we see a gap (start >= currentMaxEnd), then we emit
  // lane assignments for the cluster and reset.
  let cluster: T[] = [];
  let currentMaxEnd = -Infinity;

  const flushCluster = () => {
    if (cluster.length === 0) return;
    // Greedy lane assignment. `laneEnds[i]` = end time of the
    // last event placed in lane i. A new event reuses the
    // lowest-numbered lane whose end is ≤ the event's start.
    const laneEnds: number[] = [];
    for (const ev of cluster) {
      const start = ev.start.getTime();
      let lane = laneEnds.findIndex((end) => end <= start);
      if (lane === -1) {
        laneEnds.push(ev.end.getTime());
        lane = laneEnds.length - 1;
      } else {
        laneEnds[lane] = ev.end.getTime();
      }
      result.push({ event: ev, lane, laneCount: 0 });
    }
    // Patch the laneCount on every entry we just emitted now
    // that we know the cluster's max width.
    const laneCount = laneEnds.length;
    for (let i = result.length - cluster.length; i < result.length; i++) {
      result[i]!.laneCount = laneCount;
    }
    cluster = [];
    currentMaxEnd = -Infinity;
  };

  for (const ev of sorted) {
    if (ev.start.getTime() >= currentMaxEnd) {
      flushCluster();
    }
    cluster.push(ev);
    currentMaxEnd = Math.max(currentMaxEnd, ev.end.getTime());
  }
  flushCluster();

  return result;
}

// ── Which days does an event cover? ────────────────────────────────────

/** Hard stop so a corrupt multi-year event can't fan out thousands of
 *  day buckets. */
const MAX_EVENT_DAYS = 366;

/**
 * Every calendar day (`YYYY-MM-DD`) an event touches, for bucketing a
 * multi-day event into each of its day cells.
 *
 *  - All-day events are date-only values (ADR-012): first/last day are
 *    `dateOnlyKey(start)` / `dateOnlyKey(end)` (the end is INCLUSIVE),
 *    no zone applied.
 *  - Timed events are instants: days in the viewer's `tz`. An event
 *    ending exactly at midnight does not touch the next day.
 *
 * `within` (inclusive keys, e.g. the visible week) clips the result.
 */
export function eventDayKeys(
  event: { startTime: Date; endTime: Date; isAllDay: boolean },
  tz: string,
  within?: { first: DayKey; last: DayKey },
): DayKey[] {
  let first: DayKey;
  let last: DayKey;
  if (event.isAllDay) {
    first = dateOnlyKey(event.startTime);
    last = dateOnlyKey(event.endTime);
  } else {
    first = dateKeyInTz(event.startTime, tz);
    last = dateKeyInTz(event.endTime, tz);
    const endsAtMidnight =
      event.endTime.getTime() > event.startTime.getTime() &&
      toWallClockInput(event.endTime, tz).endsWith("T00:00");
    if (endsAtMidnight && last > first) last = addDaysToKey(last, -1);
  }
  if (last < first) last = first;
  if (within) {
    if (first < within.first) first = within.first;
    if (last > within.last) last = within.last;
  }
  const keys: DayKey[] = [];
  for (let k = first; k <= last && keys.length < MAX_EVENT_DAYS; k = addDaysToKey(k, 1)) {
    keys.push(k);
  }
  return keys;
}
