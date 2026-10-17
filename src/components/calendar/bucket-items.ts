/**
 * Day bucketing shared by the week, month, day and agenda views.
 *
 * Which calendar day(s) an item occupies depends on what kind of
 * value it is (ADR-012):
 *
 *   - Deadlines (`dueDate`) and all-day events are DATE-ONLY values:
 *     calendar dates stored at UTC midnight and read in UTC. No
 *     viewer / browser / server zone ever applies — `dateOnlyKey`
 *     gives the same day on the UTC production host, a Denver laptop
 *     and a browser anywhere. (Bucketing them with `dateKeyInTz`
 *     shifted every deadline one day early for Denver users.)
 *   - All-day events may span several days: they occupy every key
 *     from their start date through their (inclusive) end date.
 *   - Timed events are INSTANTS: they bucket by the viewer's
 *     calendar day (`dateKeyInTz`) of their start. Overnight timed
 *     events stay on their start day — the hour-grid chips are
 *     positioned from the start time, so a continuation entry on
 *     the next day would be drawn at the wrong offset.
 *
 * Pure and client-safe so the views, the agenda and the tests share
 * one implementation.
 */

import {
  addDaysToKey,
  dateKeyInTz,
  dateOnlyKey,
  daysBetweenKeys,
  type DayKey,
} from "@/lib/format-date";
import type { CalendarItem } from "@/lib/queries/calendar";

/** Hard cap on a single event's day span, so a corrupt end date
 *  can't make the views loop over centuries. */
const MAX_SPAN_DAYS = 366;

/** Every calendar day (`YYYY-MM-DD`) `item` occupies, in order. */
export function itemDayKeys(item: CalendarItem, tz: string): DayKey[] {
  if (item.kind === "deadline") return [dateOnlyKey(item.dueDate)];
  if (!item.isAllDay) return [dateKeyInTz(item.startTime, tz)];
  const first = dateOnlyKey(item.startTime);
  const last = dateOnlyKey(item.endTime);
  const span = daysBetweenKeys(first, last);
  if (!(span > 0)) return [first];
  const keys: DayKey[] = [];
  for (let i = 0; i <= Math.min(span, MAX_SPAN_DAYS); i++) {
    keys.push(addDaysToKey(first, i));
  }
  return keys;
}

/** True when `item` occupies the calendar day `dayKey`. */
export function itemIsOnDay(
  item: CalendarItem,
  dayKey: DayKey,
  tz: string
): boolean {
  return itemDayKeys(item, tz).includes(dayKey);
}

/** Group items by every day they occupy. Insertion order within a
 *  day follows the input order. */
export function bucketItemsByDay(
  items: readonly CalendarItem[],
  tz: string
): Map<DayKey, CalendarItem[]> {
  const byDay = new Map<DayKey, CalendarItem[]>();
  for (const item of items) {
    for (const key of itemDayKeys(item, tz)) {
      const list = byDay.get(key);
      if (list) list.push(item);
      else byDay.set(key, [item]);
    }
  }
  return byDay;
}

/** Critical deadlines first, everything else after (stable). */
export function deadlineRank(d: { deadlineKind: string }): number {
  return d.deadlineKind === "critical" ? 0 : 1;
}

/** Short weekday ("Mon") of a noon-UTC day Date from the week/month
 *  `days` arrays — read in UTC so the server and every browser agree. */
export function weekdayShort(day: Date): string {
  return day.toLocaleString("en-US", { weekday: "short", timeZone: "UTC" });
}
