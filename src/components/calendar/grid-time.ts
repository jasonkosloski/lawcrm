/**
 * Pure, zone-aware math for the week/day hour grid.
 *
 * The grid used to read event times with the runtime's local getters
 * (`getHours()` etc.). Those components server-render on Vercel in UTC
 * and hydrate in the viewer's zone, so chips first painted at UTC-hour
 * rows with UTC labels and then jumped (and logged a hydration error),
 * and drops built Dates with `setHours`, a third zone convention. Every
 * helper here takes the user's PROFILE zone (`useUserTimeZone()`) so the
 * server pass, the client pass and the drop math agree.
 *
 * A column is identified by its `dayKey` (`YYYY-MM-DD` in the user's
 * zone — the UTC date of the column's noon-UTC `day` prop). All-day
 * events are date-only values (UTC midnight, ADR-012) and never touch
 * a zone.
 */

import { HOUR_HEIGHT_PX, HOURS } from "@/lib/calendar-utils";
import {
  dateKeyInTz,
  daysBetweenKeys,
  parseWallClock,
  toWallClockInput,
  type DayKey,
} from "@/lib/format-date";
import type { CalendarEventDragData } from "./event-drag";

export const GRID_START_HOUR = HOURS[0]!;
const GRID_START_MIN = GRID_START_HOUR * 60;
/** Minutes the hour grid spans (6am to 10pm = 960). */
export const GRID_MINUTES = HOURS.length * 60;
/** Pixel height of the whole hour grid. */
export const GRID_HEIGHT_PX = (GRID_MINUTES / 60) * HOUR_HEIGHT_PX;
/** Drag/resize snap resolution. */
export const SNAP_MINUTES = 15;
const MIN_CHIP_PX = 24;

export const clamp = (n: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, n));

/** Minutes from `dayKey`'s midnight (in `tz`) to `d`'s wall-clock
 *  time. Negative before the day, above 1440 after it. */
export function minutesOnDay(d: Date, dayKey: DayKey, tz: string): number {
  const wall = toWallClockInput(d, tz); // YYYY-MM-DDTHH:mm
  const dayDelta = daysBetweenKeys(dayKey, wall.slice(0, 10));
  return (
    dayDelta * 1440 + Number(wall.slice(11, 13)) * 60 + Number(wall.slice(14, 16))
  );
}

/** "9:00am" in `tz`. */
export function formatTimeShort(d: Date, tz: string): string {
  const wall = toWallClockInput(d, tz);
  const h24 = Number(wall.slice(11, 13));
  const m = wall.slice(14, 16);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m}${h24 < 12 ? "am" : "pm"}`;
}

export type ChipBox = {
  top: number;
  height: number;
  /** The event starts before the first grid hour / earlier day. */
  clippedTop: boolean;
  /** The event ends after the last grid hour / later day. */
  clippedBottom: boolean;
};

/**
 * Where a timed chip sits inside the column for `dayKey`. Clamped to
 * the grid so a 5:30am flight, a 10:30pm call or a Mon–Tue block stays
 * inside its column instead of drawing over the all-day strip, past
 * the bottom, or 1,500px tall.
 */
export function chipBox(
  start: Date,
  end: Date,
  dayKey: DayKey,
  tz: string
): ChipBox {
  const s = minutesOnDay(start, dayKey, tz) - GRID_START_MIN;
  const e = minutesOnDay(end, dayKey, tz) - GRID_START_MIN;
  const topMin = clamp(s, 0, GRID_MINUTES);
  const bottomMin = clamp(e, 0, GRID_MINUTES);
  const height = Math.max(
    MIN_CHIP_PX,
    ((bottomMin - topMin) / 60) * HOUR_HEIGHT_PX - 2
  );
  const top = Math.min((topMin / 60) * HOUR_HEIGHT_PX, GRID_HEIGHT_PX - height);
  return { top, height, clippedTop: s < 0, clippedBottom: e > GRID_MINUTES };
}

/** Top offset (px) of the "now" line, or null when `now` isn't on
 *  `dayKey` (in `tz`) or is outside the visible hours. */
export function nowTopPx(now: Date, dayKey: DayKey, tz: string): number | null {
  if (dateKeyInTz(now, tz) !== dayKey) return null;
  const rel = minutesOnDay(now, dayKey, tz) - GRID_START_MIN;
  if (rel < 0 || rel > GRID_MINUTES) return null;
  return (rel / 60) * HOUR_HEIGHT_PX;
}

/** The instant at `totalMinutes` past the grid's first hour on the
 *  `dayKey` calendar day in `tz`. */
export function instantAtGridMinutes(
  dayKey: DayKey,
  totalMinutes: number,
  tz: string
): Date {
  const abs = GRID_START_MIN + totalMinutes;
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  // dayKey is built from a valid day Date and hh:mm from the clamped
  // grid range, so this cannot be null.
  return parseWallClock(`${dayKey}T${hh}:${mm}`, tz)!;
}

/** Snapped minutes-from-grid-start for a cursor Y inside a column. */
export function snapMinutes(
  cursorYInColumn: number,
  data: Pick<CalendarEventDragData, "isAllDay" | "grabOffsetY">
): number {
  const chipTopY = data.isAllDay
    ? cursorYInColumn
    : cursorYInColumn - data.grabOffsetY;
  return clamp(
    Math.round(((chipTopY / HOUR_HEIGHT_PX) * 60) / SNAP_MINUTES) * SNAP_MINUTES,
    0,
    GRID_MINUTES - SNAP_MINUTES
  );
}

export type Schedule = { isAllDay: boolean; start: Date; end: Date };

/**
 * New schedule for dropping a chip on the time grid, or null when the
 * drop would change nothing (the chip landed back on its own slot —
 * writing it anyway would snap an off-grid 9:07 start to 9:00, bump
 * updatedAt and push to Google for no reason).
 */
export function computeTimedDrop(
  data: CalendarEventDragData,
  cursorYInColumn: number,
  dayKey: DayKey,
  tz: string
): Schedule | null {
  const total = snapMinutes(cursorYInColumn, data);
  const start = instantAtGridMinutes(dayKey, total, tz);
  const originalStart = new Date(data.startTimeIso);
  const originalEnd = new Date(data.endTimeIso);
  const durationMs = data.isAllDay
    ? 2 * 60 * 60 * 1000
    : Math.max(
        SNAP_MINUTES * 60_000,
        originalEnd.getTime() - originalStart.getTime()
      );
  const end = new Date(start.getTime() + durationMs);

  if (!data.isAllDay) {
    const originalMin = minutesOnDay(originalStart, dayKey, tz) - GRID_START_MIN;
    const insideGrid = originalMin >= 0 && originalMin < GRID_MINUTES;
    const ownSlot =
      clamp(
        Math.round(originalMin / SNAP_MINUTES) * SNAP_MINUTES,
        0,
        GRID_MINUTES - SNAP_MINUTES
      ) === total;
    if (insideGrid && ownSlot) return null;
  }
  return { isAllDay: false, start, end };
}

/** Lowest start a top-edge resize may reach: the grid's first hour on
 *  the event's day — unless the event already starts above the grid,
 *  in which case it may not be pulled any earlier than it is. */
export function clampStartToGrid(
  proposed: Date,
  originalStart: Date,
  tz: string
): Date {
  const key = dateKeyInTz(originalStart, tz);
  const gridStart = instantAtGridMinutes(key, 0, tz);
  const min = originalStart.getTime() < gridStart.getTime() ? originalStart : gridStart;
  return proposed.getTime() < min.getTime() ? min : proposed;
}

/** Highest end a bottom-edge resize may reach: the grid's last hour
 *  on the event's end day — unless it already ends below the grid. */
export function clampEndToGrid(
  proposed: Date,
  originalEnd: Date,
  tz: string
): Date {
  const key = dateKeyInTz(originalEnd, tz);
  const gridEnd = instantAtGridMinutes(key, GRID_MINUTES, tz);
  const max = originalEnd.getTime() > gridEnd.getTime() ? originalEnd : gridEnd;
  return proposed.getTime() > max.getTime() ? max : proposed;
}
