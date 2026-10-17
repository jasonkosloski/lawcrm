/**
 * Calendar-specific drag-and-drop typing.
 *
 * Centralizes the kind sentinel + payload shape so the source
 * (chip drag) and target (day column drop zones) agree on the
 * wire format. The kind string is a constant — drop targets in
 * other features (kanban etc.) won't accidentally pick up a
 * calendar event.
 */

import {
  addDaysToKey,
  dateOnlyKey,
  daysBetweenKeys,
  parseDateOnly,
  type DayKey,
} from "@/lib/format-date";

export const CALENDAR_EVENT_KIND = "calendar-event" as const;

export type CalendarEventDragData = {
  /** The event's id — drop handler dispatches `moveCalendarEvent`
   *  with this. */
  id: string;
  /** Whether the dragged event is currently all-day. Drop
   *  handlers branch on this to compute the new schedule:
   *  - all-day → time slot: start at slot, end +2h
   *  - timed → time slot: shift, preserve duration
   *  - timed → all-day bar: collapse to all-day on that date
   *  - all-day → all-day: just change the date, stay all-day */
  isAllDay: boolean;
  /** Original schedule, ISO strings, used for duration-preserve
   *  + same-day no-op detection. */
  startTimeIso: string;
  endTimeIso: string;
  /** Pixel offset between the cursor and the chip's top edge
   *  at dragstart. The drop target subtracts this from the
   *  cursor's Y so the chip lands where the user *sees* it
   *  (intuitive) instead of where the cursor is (jumps the
   *  chip up by however much the user grabbed below its top
   *  edge). Only relevant for timed-chip → time-slot drops;
   *  all-day drops snap to the day regardless. */
  grabOffsetY: number;
};

/**
 * Schedule produced by dropping a chip on the all-day cell for
 * `dayKey`, or null when the drop is a no-op (an all-day event
 * already starting on that day).
 *
 * All-day bounds are date-only values (ADR-012), so the result is
 * UTC midnight of the day keys, never a browser-local midnight. An
 * all-day event keeps its span (a Mon-Wed event dropped on Thursday
 * becomes Thu-Sat); a timed event collapses to a single day.
 */
export function allDayDropSchedule(
  data: Pick<CalendarEventDragData, "isAllDay" | "startTimeIso" | "endTimeIso">,
  dayKey: DayKey
): { isAllDay: true; start: Date; end: Date } | null {
  let span = 0;
  if (data.isAllDay) {
    const first = dateOnlyKey(new Date(data.startTimeIso));
    if (first === dayKey) return null;
    const last = dateOnlyKey(new Date(data.endTimeIso));
    span = Math.max(0, daysBetweenKeys(first, last));
  }
  const start = parseDateOnly(dayKey);
  const end = parseDateOnly(addDaysToKey(dayKey, span));
  if (!start || !end) return null;
  return { isAllDay: true, start, end };
}
