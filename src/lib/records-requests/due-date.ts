/**
 * Response-due-date rules for records requests. Pure, no DB.
 *
 * Inputs and outputs are date-only values stored at UTC midnight
 * (ADR-012); all arithmetic is UTC so no server or viewer zone leaks in.
 */

export type RecordsResponseUnit = "CALENDAR_DAYS" | "BUSINESS_DAYS";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Shift a date-only value by whole calendar days (negative goes back). */
export function addCalendarDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function isWeekend(date: Date): boolean {
  const dow = date.getUTCDay();
  return dow === 0 || dow === 6;
}

/**
 * Due date for a response window that starts when the request is sent.
 * CALENDAR_DAYS counts straight through weekends. BUSINESS_DAYS counts
 * forward from the day after `sentAt`, skipping Saturdays and Sundays.
 */
export function computeResponseDue(
  sentAt: Date,
  amount: number,
  unit: RecordsResponseUnit,
): Date {
  if (unit === "CALENDAR_DAYS") return addCalendarDays(sentAt, amount);

  let cursor = sentAt;
  let remaining = amount;
  while (remaining > 0) {
    cursor = addCalendarDays(cursor, 1);
    if (!isWeekend(cursor)) remaining -= 1;
  }
  return cursor;
}
