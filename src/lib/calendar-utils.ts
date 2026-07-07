/**
 * Calendar URL helpers
 *
 * Parses and serializes the `?view=` and `?d=` params the calendar
 * page uses for state. All date arithmetic goes through `date-fns`.
 */

import {
  addDays,
  addMonths,
  format,
  parseISO,
  startOfDay,
  startOfMonth,
} from "date-fns";
import { dateKeyInTz, instantInTz } from "@/lib/format-date";

export type CalendarView = "week" | "month" | "day";
export const DEFAULT_VIEW: CalendarView = "week";

/**
 * First day of the week.
 *
 * 0 = Sunday (US convention), 1 = Monday (European / ISO convention).
 * Currently a module-level constant — when the `UserPreferences` model
 * lands, this will become a per-user setting resolved via the current
 * user context. Every caller that needs week-start goes through here,
 * so swapping is a single edit.
 */
export const WEEK_STARTS_ON: 0 | 1 = 0;

/** True if the given date falls on Saturday or Sunday. Used to give
 *  weekend cells/columns a subtle warm tint in the calendar views. */
export function isWeekend(date: Date): boolean {
  const d = date.getDay();
  return d === 0 || d === 6;
}

/**
 * Parse `?view=` / `?d=` into calendar state.
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
  now: Date = new Date()
): { view: CalendarView; focal: Date } {
  const rawView = Array.isArray(sp.view) ? sp.view[0] : sp.view;
  const view: CalendarView =
    rawView === "week" || rawView === "month" || rawView === "day"
      ? rawView
      : DEFAULT_VIEW;

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

export const toDateParam = (d: Date): string => format(d, "yyyy-MM-dd");

/** Build an href for the calendar page with new view/date values. */
export function buildCalendarHref(
  view: CalendarView,
  focal: Date,
  override: { view?: CalendarView; focal?: Date } = {}
): string {
  const v = override.view ?? view;
  const d = override.focal ?? focal;
  const params = new URLSearchParams();
  if (v !== DEFAULT_VIEW) params.set("view", v);
  params.set("d", toDateParam(d));
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
  tz: string
): { day: Date; rangeStart: Date; rangeEnd: Date } {
  const [y, m, d] = toDateParam(focal).split("-").map(Number) as [
    number,
    number,
    number,
  ];
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
export function stepCalendarFocal(
  view: CalendarView,
  focal: Date,
  dir: 1 | -1
): Date {
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

/** Position an event's top offset (in px) within the hour grid. */
export function eventTopPx(start: Date): number {
  const h = start.getHours() + start.getMinutes() / 60;
  const from = HOURS[0];
  return (h - from) * HOUR_HEIGHT_PX;
}

/** Height of an event block in px (min 24 for visibility). */
export function eventHeightPx(start: Date, end: Date): number {
  const hours = (end.getTime() - start.getTime()) / (60 * 60 * 1000);
  return Math.max(24, hours * HOUR_HEIGHT_PX - 2);
}

/** Top offset (px) of the "now" line within the hour grid, or null if
 *  `now` is not on `day` or is outside the visible hour range. */
export function nowOffsetPx(now: Date, day: Date): number | null {
  if (now.toDateString() !== day.toDateString()) return null;
  const h = now.getHours() + now.getMinutes() / 60;
  const from = HOURS[0];
  const to = HOURS[HOURS.length - 1] + 1;
  if (h < from || h > to) return null;
  return (h - from) * HOUR_HEIGHT_PX;
}

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
  events: readonly T[]
): LayoutResult<T>[] {
  if (events.length === 0) return [];
  const sorted = [...events].sort(
    (a, b) => a.start.getTime() - b.start.getTime()
  );

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
