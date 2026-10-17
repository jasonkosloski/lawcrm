/**
 * Display helpers for a lead's live statute countdown
 * (`statuteDaysRemaining` from src/lib/queries/leads.ts).
 *
 * Client-safe and pure: the queue and the lead Overview share one set of
 * thresholds and wording so the warning can't drift between them.
 */

/** At or below this many days left the statute shows as a warning. */
export const STATUTE_WARN_DAYS = 30;

export type StatuteDisplay = {
  /** Compact form for the queue ("340d", "12d", "5d over"). */
  short: string;
  /** Long form for the Overview ("340 days", "5 days past"). */
  long: string;
  /** True when the window is within STATUTE_WARN_DAYS or already run. */
  warn: boolean;
  /** True when the window has already run. */
  expired: boolean;
};

export function describeStatuteRemaining(days: number): StatuteDisplay {
  if (days < 0) {
    const over = -days;
    return {
      short: `${over}d over`,
      long: `${over} day${over === 1 ? "" : "s"} past`,
      warn: true,
      expired: true,
    };
  }
  return {
    short: `${days}d`,
    long: `${days} day${days === 1 ? "" : "s"}`,
    warn: days <= STATUTE_WARN_DAYS,
    expired: false,
  };
}
