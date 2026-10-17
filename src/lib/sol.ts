import { dateOnlyKey, parseDateOnly } from "@/lib/format-date";

/**
 * Statute-of-limitations utilities.
 *
 * The firm-wide convention: statute periods are entered in human
 * units (years / months / days) and stored as a single `Int` of
 * total days on `PracticeArea.statutePeriodDays`, using a 365-day
 * year + 30-day month.
 *
 * KNOWN LIMITATION (F093/F731/F945, deferred to the schema batch):
 * that is a day-count convention, NOT calendar arithmetic. Statutes
 * written as "two years" or "six months" run to the same calendar
 * date, so the auto-computed date can be early by a day or more
 * across a leap year, and a month-based period can land a day or two
 * early or late. The computed date is a convenience: the lawyer must
 * verify it, and an explicit date typed on the matter always wins.
 * The proper fix stores {years, months, days} on PracticeArea and
 * computes with UTC calendar arithmetic (needs a migration).
 *
 * Both directions live here so the practice-area form can
 * round-trip the user's input through the schema. The total-days
 * value always round-trips exactly; the year/month/day breakdown
 * only survives when the input already matches the greedy
 * decomposition (months/days small enough not to roll into the
 * next unit under the 365/30 convention — e.g. "18 months" packs
 * to 540 days and unpacks as "1 year 5 months 25 days").
 *
 * Matter incident / SOL dates are date-only values (ADR-012): UTC
 * midnight, read in UTC, never shifted by any time zone.
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
 *  (createMatter / updateMatter / lead conversion) uses this to
 *  auto-populate `Matter.statuteOfLimitationsDate`; no form
 *  previews it, so the result is only visible after saving.
 *  Pure day arithmetic — see the KNOWN LIMITATION in the header. */
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

/** `sourceType` that marks the one auto-managed "Statute of
 *  limitations" Deadline per matter. The Matter SOL fields are
 *  authoritative; that Deadline row is only a mirror, so the deadline
 *  actions refuse to move or delete it. One shared constant for the
 *  matter and deadline actions. */
export const SOL_SOURCE_TYPE = "statute_of_limitations";

/** `YYYY-MM-DD` of a date-only value (ADR-012). Alias of `dateOnlyKey`,
 *  kept for the existing importers. */
export const solDayKey = dateOnlyKey;

/** Strictly parse an `<input type="date">` string (`YYYY-MM-DD`) into
 *  UTC midnight, or null for anything malformed or a non-existent
 *  calendar day (2026-02-31), so a tampered post becomes a field
 *  error instead of an Invalid Date reaching Prisma. Alias of
 *  `parseDateOnly` (ADR-012), kept for the existing importers. */
export const parseSolDateInput = parseDateOnly;

/** Was the stored SOL date derived automatically (as opposed to typed
 *  in as a manual override)? Nothing records provenance, so infer it:
 *  a null SOL is trivially auto, and a stored date equal to what the
 *  stored incident date + stored area period compute is auto. A date
 *  that matches nothing computable is treated as a manual override —
 *  the safe direction (it is kept, never silently recomputed). */
export function isAutoDerivedSol(input: {
  storedSol: Date | null;
  storedIncident: Date | null;
  storedPeriodDays: number | null;
}): boolean {
  if (!input.storedSol) return true;
  const computed = computeSolDate(input.storedIncident, input.storedPeriodDays);
  return !!computed && solDayKey(computed) === solDayKey(input.storedSol);
}

/** Decide the SOL date to persist when an existing matter is edited.
 *
 *  - Posted date differs from the stored one -> the user typed it:
 *    manual override wins.
 *  - Posted date equals the stored one (the form pre-fills a real
 *    override) -> keep it if it was a manual override; if it was
 *    auto-derived, recompute from the posted incident date + the
 *    (possibly new) area period so an incident correction or area
 *    switch can't leave a stale statute date.
 *  - Posted date empty -> auto-compute (the form leaves the override
 *    empty while the SOL is auto-derived).
 *  When auto-compute is impossible only because the new area has no
 *  period configured, or because the incident date of an auto-derived
 *  date was cleared, the stored date is kept rather than silently dropped. */
export function resolveEditedSolDate(input: {
  posted: Date | null;
  stored: Date | null;
  storedIncident: Date | null;
  storedPeriodDays: number | null;
  incident: Date | null;
  periodDays: number | null;
}): Date | null {
  const { posted, stored } = input;
  const auto = () => {
    const computed = computeSolDate(input.incident, input.periodDays);
    if (!computed && stored && input.incident && !input.periodDays) {
      return stored;
    }
    // Clearing the incident date (a mis-click) must not silently drop
    // a live AUTO-derived statute date: keep the stored one. A manual
    // override that the user emptied is a deliberate clear and still
    // clears.
    if (
      !computed &&
      stored &&
      !input.incident &&
      isAutoDerivedSol({
        storedSol: stored,
        storedIncident: input.storedIncident,
        storedPeriodDays: input.storedPeriodDays,
      })
    ) {
      return stored;
    }
    return computed;
  };
  if (posted) {
    if (stored && solDayKey(posted) === solDayKey(stored)) {
      return isAutoDerivedSol({
        storedSol: stored,
        storedIncident: input.storedIncident,
        storedPeriodDays: input.storedPeriodDays,
      })
        ? auto()
        : stored;
    }
    return posted;
  }
  return auto();
}
