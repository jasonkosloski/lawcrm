import { dateOnlyKey, parseDateOnly } from "@/lib/format-date";

/**
 * Statute-of-limitations utilities (ADR-035).
 *
 * A practice area's statute period is a calendar amount + unit
 * (`PracticeArea.statutePeriodAmount` / `statutePeriodUnit`): "2 years",
 * "18 months", "180 days". The SOL date is computed with calendar
 * arithmetic on the incident's UTC date-only value (ADR-012: UTC
 * midnight, read in UTC, never shifted by any time zone):
 *
 *   - DAYS   : add N days.
 *   - MONTHS : move N calendar months forward, keeping the day of month.
 *   - YEARS  : move N calendar years forward (= 12N months).
 *
 * Month-end rule: when the target month is shorter than the incident's
 * day of month, the result CLAMPS to the last day of the target month.
 * So 2024-02-29 + 1 year = 2025-02-28 (non-leap target), 2024-02-29 +
 * 4 years = 2028-02-29, and 2026-01-31 + 1 month = 2026-02-28. This is
 * the usual reading of "two years from" for statutes; the lawyer still
 * verifies the date and an explicit date typed on the matter wins.
 *
 * The legacy 365-day-year / 30-day-month `statutePeriodDays` column is
 * deprecated and no longer read (the migration backfilled amount/unit).
 */

export const SOL_PERIOD_UNITS = ["DAYS", "MONTHS", "YEARS"] as const;
export type SolPeriodUnit = (typeof SOL_PERIOD_UNITS)[number];

export type SolPeriod = {
  amount: number;
  unit: SolPeriodUnit;
};

export function isSolPeriodUnit(v: unknown): v is SolPeriodUnit {
  return typeof v === "string" && (SOL_PERIOD_UNITS as readonly string[]).includes(v);
}

/** Build a period from the two nullable DB columns. Null unless BOTH
 *  are present and the amount is a positive integer. */
export function toSolPeriod(
  amount: number | null | undefined,
  unit: string | null | undefined,
): SolPeriod | null {
  if (
    typeof amount !== "number" ||
    !Number.isInteger(amount) ||
    amount <= 0 ||
    !isSolPeriodUnit(unit)
  ) {
    return null;
  }
  return { amount, unit };
}

function daysInUtcMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** Add `months` calendar months to a UTC date-only value, clamping the
 *  day of month to the target month's length (see header rule). */
export function addUtcMonths(date: Date, months: number): Date {
  const total = date.getUTCFullYear() * 12 + date.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const monthIndex = total - year * 12;
  const day = Math.min(date.getUTCDate(), daysInUtcMonth(year, monthIndex));
  const out = new Date(date);
  // setUTCFullYear with all three parts avoids the intermediate
  // overflow (e.g. Jan 31 -> setUTCMonth(1) -> Mar 3).
  out.setUTCFullYear(year, monthIndex, day);
  return out;
}

/** Compute the SOL date from an incident date + statute period.
 *  Returns null when either input is missing. The action layer
 *  (createMatter / updateMatter / lead conversion) uses this to
 *  auto-populate `Matter.statuteOfLimitationsDate`. UTC calendar
 *  arithmetic throughout - local-time setters would shift the result
 *  across a DST boundary in the server's zone. */
export function computeSolDate(
  incidentDate: Date | null | undefined,
  period: SolPeriod | null | undefined,
): Date | null {
  if (!incidentDate || !period || !(period.amount > 0)) return null;
  switch (period.unit) {
    case "DAYS": {
      const result = new Date(incidentDate);
      result.setUTCDate(result.getUTCDate() + period.amount);
      return result;
    }
    case "MONTHS":
      return addUtcMonths(incidentDate, period.amount);
    case "YEARS":
      return addUtcMonths(incidentDate, period.amount * 12);
    default:
      return null;
  }
}

/** Human-readable rendering of a statute period ("2 years"). Used on
 *  the SOL card subtitle and the new/edit matter forms. */
export function formatStatutePeriod(period: SolPeriod | null): string {
  if (!period || !(period.amount > 0)) return "Not configured";
  const noun = period.unit.toLowerCase().slice(0, -1);
  return `${period.amount} ${noun}${period.amount === 1 ? "" : "s"}`;
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
  storedPeriod: SolPeriod | null;
}): boolean {
  if (!input.storedSol) return true;
  const computed = computeSolDate(input.storedIncident, input.storedPeriod);
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
  storedPeriod: SolPeriod | null;
  incident: Date | null;
  period: SolPeriod | null;
}): Date | null {
  const { posted, stored } = input;
  const auto = () => {
    const computed = computeSolDate(input.incident, input.period);
    if (!computed && stored && input.incident && !input.period) {
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
        storedPeriod: input.storedPeriod,
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
        storedPeriod: input.storedPeriod,
      })
        ? auto()
        : stored;
    }
    return posted;
  }
  return auto();
}
