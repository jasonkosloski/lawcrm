/**
 * Plain-language date labels for the records request page's "Sent" and
 * "Response due" tiles. Pure; callers pass whole-day counts already
 * computed in the viewer's zone (daysUntilDateOnly, ADR-012).
 */

import type { RecordsResponseUnit } from "./due-date";

function days(n: number): string {
  return `${n} ${n === 1 ? "day" : "days"}`;
}

/** "Today", "Yesterday", "3 days ago". `daysSince` ≥ 0. */
export function sentAgoLabel(daysSince: number): string {
  if (daysSince <= 0) return "Today";
  if (daysSince === 1) return "Yesterday";
  return `${days(daysSince)} ago`;
}

/** Countdown to the response due date: "3 days left", "Due today",
 *  "2 days overdue". Negative `daysUntil` is overdue. */
export function dueCountdownLabel(daysUntil: number): {
  text: string;
  overdue: boolean;
} {
  if (daysUntil < 0) return { text: `${days(-daysUntil)} overdue`, overdue: true };
  if (daysUntil === 0) return { text: "Due today", overdue: false };
  return { text: `${days(daysUntil)} left`, overdue: false };
}

/** The rule behind a computed due date: "3 business days after sending". */
export function responsePeriodLabel(amount: number, unit: RecordsResponseUnit): string {
  const noun =
    unit === "BUSINESS_DAYS"
      ? amount === 1
        ? "business day"
        : "business days"
      : amount === 1
        ? "day"
        : "days";
  return `${amount} ${noun} after sending`;
}
