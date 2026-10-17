/**
 * Zone-aware defaults for capture forms (client-safe, pure).
 *
 * `todayDateString` / `nextHourDateTimeString` in note-constants read
 * the BROWSER's clock zone. The rest of the app (server parsing, event
 * display) works in the user's PROFILE zone (ADR-012), so a default
 * computed in a different browser zone would disagree with how the
 * server then reads the value. These variants take the profile zone
 * (`useUserTimeZone()`), keeping the form default and the server's
 * interpretation in the same frame.
 */

import { parseWallClock, todayKey, toWallClockInput } from "@/lib/format-date";

/** The viewer's today as `YYYY-MM-DD` (a date input's value). */
export function todayInput(tz: string, now: Date = new Date()): string {
  return todayKey(tz, now);
}

/** The next top-of-the-hour in `tz`, plus `addHours`, as a
 *  datetime-local value. At 2:20 PM it returns 3:00 PM (and at exactly
 *  3:00 PM, 4:00 PM — the next full hour, like the browser helper). */
export function nextHourInput(
  tz: string,
  addHours = 0,
  now: Date = new Date()
): string {
  const wall = toWallClockInput(now, tz); // "YYYY-MM-DDTHH:mm"
  const thisHour = parseWallClock(`${wall.slice(0, 13)}:00`, tz);
  const base = thisHour ?? now;
  return toWallClockInput(
    new Date(base.getTime() + (1 + addHours) * 60 * 60 * 1000),
    tz
  );
}
