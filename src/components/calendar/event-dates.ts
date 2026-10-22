/**
 * Date helpers for the event surfaces that attach records (time
 * entries) to a calendar event. Pure and importable from both server
 * and client components.
 */

import { dateKeyInTz, dateOnlyKey, todayKey, type DayKey } from "@/lib/format-date";

/**
 * The date a "log time for this event" entry should default to: the
 * event's own calendar day (an all-day event's stored date, a timed
 * event's day in the viewer's zone), clamped to the viewer's today so
 * a future event doesn't pre-fill a future billing date. Without it
 * the composer defaulted to today, so time logged for last Tuesday's
 * deposition was billed to today unless the user noticed.
 */
export function eventTimeEntryDate(
  event: { startTime: Date; isAllDay: boolean },
  tz: string,
  now: Date = new Date(),
): DayKey {
  const eventKey = event.isAllDay ? dateOnlyKey(event.startTime) : dateKeyInTz(event.startTime, tz);
  const today = todayKey(tz, now);
  return eventKey > today ? today : eventKey;
}
