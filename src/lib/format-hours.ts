/**
 * Display helper for hour quantities.
 *
 * Time is recorded in quarter-hour increments (TIME_ENTRY_INCREMENT_HOURS
 * = 0.25), so `toFixed(1)` misstated them: 0.25h read "0.3h" and 0.75h
 * "0.8h", disagreeing with the invoice math. Two decimals are exact for
 * quarter hours; trailing zeros are trimmed so whole and half hours stay
 * short ("2", "1.5", "0.25").
 */
export function formatHours(hours: number): string {
  return String(Number(hours.toFixed(2)));
}
