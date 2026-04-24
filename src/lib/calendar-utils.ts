/**
 * Calendar URL helpers
 *
 * Parses and serializes the `?view=` and `?d=` params the calendar
 * page uses for state. All date arithmetic goes through `date-fns`.
 */

import { addDays, format, parseISO, startOfDay } from "date-fns";

export type CalendarView = "week" | "month";
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

export function parseCalendarParams(
  sp: Record<string, string | string[] | undefined>
): { view: CalendarView; focal: Date } {
  const rawView = Array.isArray(sp.view) ? sp.view[0] : sp.view;
  const view: CalendarView =
    rawView === "week" || rawView === "month" ? rawView : DEFAULT_VIEW;

  const rawDate = Array.isArray(sp.d) ? sp.d[0] : sp.d;
  let focal: Date;
  if (rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    try {
      focal = startOfDay(parseISO(rawDate));
    } catch {
      focal = startOfDay(new Date());
    }
  } else {
    focal = startOfDay(new Date());
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

/** Half-hour hour labels used in week view, 6am → 9pm inclusive. */
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

/** Hour (fractional) of "now" within the grid, or null if outside range. */
export function nowOffsetPx(now: Date, day: Date): number | null {
  if (now.toDateString() !== day.toDateString()) return null;
  const h = now.getHours() + now.getMinutes() / 60;
  const from = HOURS[0];
  const to = HOURS[HOURS.length - 1] + 1;
  if (h < from || h > to) return null;
  return (h - from) * HOUR_HEIGHT_PX;
}

/** Add N days preserving local time; wraps around via date-fns. */
export const addDaysLocal = addDays;
