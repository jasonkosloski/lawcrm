/**
 * Statute-of-limitations utilities.
 *
 * The firm-wide convention: statute periods are entered in human
 * units (years / months / days) and stored as a single `Int` of
 * total days on `PracticeArea.statutePeriodDays`. We use a
 * 365-day year + 30-day month convention because legal SOL
 * periods are virtually always specified in calendar days under
 * those conventions, not "two solar years."
 *
 * Both directions live here so the practice-area form can
 * round-trip the user's input through the schema. The total-days
 * value always round-trips exactly; the year/month/day breakdown
 * only survives when the input already matches the greedy
 * decomposition (months/days small enough not to roll into the
 * next unit under the 365/30 convention — e.g. "18 months" packs
 * to 540 days and unpacks as "1 year 5 months 25 days").
 */

export type StatutePeriod = {
  years: number;
  months: number;
  days: number;
};

const DAYS_PER_YEAR = 365;
const DAYS_PER_MONTH = 30;

/** Pack a year/month/day triple into total days. Negative or
 *  fractional inputs are coerced toward zero — the form layer
 *  validates ranges before calling. */
export function packStatuteDays(period: StatutePeriod): number {
  const y = Math.max(0, Math.floor(period.years || 0));
  const m = Math.max(0, Math.floor(period.months || 0));
  const d = Math.max(0, Math.floor(period.days || 0));
  return y * DAYS_PER_YEAR + m * DAYS_PER_MONTH + d;
}

/** Reverse `packStatuteDays`. Greedy from largest unit down so
 *  "730 days" displays as "2 years" rather than "24 months 10
 *  days." Round-trips when the input was entered in clean units. */
export function unpackStatuteDays(totalDays: number | null): StatutePeriod {
  if (!totalDays || totalDays <= 0) return { years: 0, months: 0, days: 0 };
  const years = Math.floor(totalDays / DAYS_PER_YEAR);
  let rem = totalDays - years * DAYS_PER_YEAR;
  const months = Math.floor(rem / DAYS_PER_MONTH);
  rem -= months * DAYS_PER_MONTH;
  return { years, months, days: rem };
}

/** Compute the SOL date from an incident date + statute period.
 *  Returns null when either input is missing. The action layer
 *  uses this to auto-populate `Matter.statuteOfLimitationsDate`
 *  on create / update; the form preview uses it to show the
 *  lawyer what the auto-computed value will be before they save. */
export function computeSolDate(
  incidentDate: Date | null | undefined,
  statutePeriodDays: number | null | undefined
): Date | null {
  if (!incidentDate || !statutePeriodDays || statutePeriodDays <= 0) {
    return null;
  }
  // Incident dates are stored as UTC-midnight calendar dates (the
  // <input type="date"> string parses to 00:00Z), and every display
  // path reads them back via getUTC* — so the day arithmetic must be
  // UTC too. Local-time setDate() would shift the result by an hour
  // when the statute period crosses a DST boundary in the server's
  // zone, landing at 23:00Z the previous day: a silent one-day-early
  // SOL date.
  const result = new Date(incidentDate);
  result.setUTCDate(result.getUTCDate() + statutePeriodDays);
  return result;
}

/** Human-readable rendering of a statute period. Used on the SOL
 *  card subtitle ("auto-computed from N days after incident") and
 *  on the practice-area edit form preview. */
export function formatStatutePeriod(totalDays: number | null): string {
  if (!totalDays || totalDays <= 0) return "Not configured";
  const { years, months, days } = unpackStatuteDays(totalDays);
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} year${years === 1 ? "" : "s"}`);
  if (months > 0) parts.push(`${months} month${months === 1 ? "" : "s"}`);
  if (days > 0) parts.push(`${days} day${days === 1 ? "" : "s"}`);
  return parts.join(" ");
}
