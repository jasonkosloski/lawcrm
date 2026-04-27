/**
 * Calendar-specific drag-and-drop typing.
 *
 * Centralizes the kind sentinel + payload shape so the source
 * (chip drag) and target (day column drop zones) agree on the
 * wire format. The kind string is a constant — drop targets in
 * other features (kanban etc.) won't accidentally pick up a
 * calendar event.
 */

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
};
