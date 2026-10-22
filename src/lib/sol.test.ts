/**
 * Tests for SOL helpers - pure functions, no DB (ADR-035).
 *
 * Coverage targets:
 *   - computeSolDate: calendar arithmetic (days / months / years),
 *     leap years, month-end clamping, time-zone independence.
 *   - toSolPeriod / formatStatutePeriod.
 *   - isAutoDerivedSol / resolveEditedSolDate with calendar periods.
 */

import { describe, expect, test } from "vitest";
import {
  addUtcMonths,
  computeSolDate,
  formatStatutePeriod,
  isAutoDerivedSol,
  parseSolDateInput,
  resolveEditedSolDate,
  toSolPeriod,
  type SolPeriod,
} from "./sol";

const d = (s: string) => new Date(s);
const Y2: SolPeriod = { amount: 2, unit: "YEARS" };
const key = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);

describe("parseSolDateInput", () => {
  test("parses a valid date to UTC midnight (same instant as new Date)", () => {
    expect(parseSolDateInput("2026-06-01")?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(parseSolDateInput("2024-02-29")).not.toBeNull();
  });
  test("rejects malformed and non-existent days", () => {
    for (const bad of [
      "",
      "garbage",
      "2026-6-1",
      "2026-02-31",
      "2025-02-29",
      "2026-13-01",
      "2026-06-01T00:00",
    ]) {
      expect(parseSolDateInput(bad)).toBeNull();
    }
  });
});

describe("isAutoDerivedSol", () => {
  test("null SOL is auto; matching computed is auto; anything else is manual", () => {
    expect(isAutoDerivedSol({ storedSol: null, storedIncident: null, storedPeriod: null })).toBe(
      true,
    );
    expect(
      isAutoDerivedSol({
        storedSol: d("2026-06-01"),
        storedIncident: d("2024-06-01"),
        storedPeriod: Y2,
      }),
    ).toBe(true);
    expect(
      isAutoDerivedSol({
        storedSol: d("2027-01-15"),
        storedIncident: d("2024-06-01"),
        storedPeriod: Y2,
      }),
    ).toBe(false);
    // Cannot be computed -> treated as a manual date (kept, never recomputed).
    expect(
      isAutoDerivedSol({ storedSol: d("2026-06-01"), storedIncident: null, storedPeriod: Y2 }),
    ).toBe(false);
  });
});

describe("resolveEditedSolDate", () => {
  const base = {
    storedIncident: d("2024-06-01"),
    storedPeriod: Y2,
    period: Y2,
  };
  test("auto-derived stored date re-posted untouched follows a new incident date", () => {
    const out = resolveEditedSolDate({
      ...base,
      posted: d("2026-06-01"),
      stored: d("2026-06-01"),
      incident: d("2024-03-01"),
    });
    expect(key(out)).toBe("2026-03-01");
  });
  test("empty posted date auto-computes", () => {
    const out = resolveEditedSolDate({
      ...base,
      posted: null,
      stored: d("2026-06-01"),
      incident: d("2024-03-01"),
    });
    expect(key(out)).toBe("2026-03-01");
  });
  test("manual stored date re-posted untouched is kept", () => {
    const out = resolveEditedSolDate({
      ...base,
      posted: d("2027-01-15"),
      stored: d("2027-01-15"),
      incident: d("2024-03-01"),
    });
    expect(key(out)).toBe("2027-01-15");
  });
  test("a different posted date always wins", () => {
    const out = resolveEditedSolDate({
      ...base,
      posted: d("2026-09-09"),
      stored: d("2026-06-01"),
      incident: d("2024-03-01"),
    });
    expect(key(out)).toBe("2026-09-09");
  });
  test("a new area with a different period recomputes", () => {
    const out = resolveEditedSolDate({
      ...base,
      period: { amount: 1, unit: "YEARS" },
      posted: d("2026-06-01"),
      stored: d("2026-06-01"),
      incident: d("2024-06-01"),
    });
    expect(key(out)).toBe("2025-06-01");
  });
  test("moving to an area with no configured period keeps the stored date rather than dropping it", () => {
    const out = resolveEditedSolDate({
      ...base,
      period: null,
      posted: d("2026-06-01"),
      stored: d("2026-06-01"),
      incident: d("2024-06-01"),
    });
    expect(key(out)).toBe("2026-06-01");
  });
  test("clearing the incident date keeps the stored SOL (no silent loss of a live statute date)", () => {
    const out = resolveEditedSolDate({
      ...base,
      posted: null,
      stored: d("2026-06-01"),
      incident: null,
    });
    expect(key(out)).toBe("2026-06-01");
    // Same when the unchanged stored date is re-posted.
    const reposted = resolveEditedSolDate({
      ...base,
      posted: d("2026-06-01"),
      stored: d("2026-06-01"),
      incident: null,
    });
    expect(key(reposted)).toBe("2026-06-01");
  });
  test("emptying a manual override with no incident date is a deliberate clear", () => {
    const out = resolveEditedSolDate({
      ...base,
      posted: null,
      stored: d("2027-01-15"), // not incident + period -> manual
      incident: null,
    });
    expect(out).toBeNull();
  });
  test("no stored date and no incident stays null", () => {
    expect(
      resolveEditedSolDate({
        ...base,
        posted: null,
        stored: null,
        incident: null,
      }),
    ).toBeNull();
  });
});

describe("toSolPeriod", () => {
  test("needs a positive integer amount and a known unit", () => {
    expect(toSolPeriod(2, "YEARS")).toEqual({ amount: 2, unit: "YEARS" });
    expect(toSolPeriod(180, "DAYS")).toEqual({ amount: 180, unit: "DAYS" });
    expect(toSolPeriod(null, "YEARS")).toBeNull();
    expect(toSolPeriod(2, null)).toBeNull();
    expect(toSolPeriod(0, "YEARS")).toBeNull();
    expect(toSolPeriod(-1, "DAYS")).toBeNull();
    expect(toSolPeriod(1.5, "DAYS")).toBeNull();
    expect(toSolPeriod(2, "WEEKS")).toBeNull();
  });
});

describe("addUtcMonths", () => {
  test("clamps to the last day of a shorter target month", () => {
    expect(key(addUtcMonths(d("2026-01-31"), 1))).toBe("2026-02-28");
    expect(key(addUtcMonths(d("2028-01-31"), 1))).toBe("2028-02-29");
    expect(key(addUtcMonths(d("2026-03-31"), 1))).toBe("2026-04-30");
  });
  test("rolls across year boundaries, forward and backward", () => {
    expect(key(addUtcMonths(d("2026-11-15"), 3))).toBe("2027-02-15");
    expect(key(addUtcMonths(d("2026-01-15"), -2))).toBe("2025-11-15");
  });
});

describe("computeSolDate (calendar arithmetic, ADR-035)", () => {
  test("N years lands on the same calendar date", () => {
    expect(key(computeSolDate(d("2024-04-15T00:00:00Z"), Y2))).toBe("2026-04-15");
    // The old 730-day convention gave 2029-03-09 for this one.
    expect(key(computeSolDate(d("2027-03-10T00:00:00Z"), Y2))).toBe("2029-03-10");
  });

  test("Feb 29 + N years clamps to Feb 28 in non-leap years, keeps Feb 29 in leap years", () => {
    const leap = d("2024-02-29T00:00:00Z");
    expect(key(computeSolDate(leap, { amount: 1, unit: "YEARS" }))).toBe("2025-02-28");
    expect(key(computeSolDate(leap, { amount: 2, unit: "YEARS" }))).toBe("2026-02-28");
    expect(key(computeSolDate(leap, { amount: 4, unit: "YEARS" }))).toBe("2028-02-29");
  });

  test("months keep the day of month and clamp at month end", () => {
    expect(key(computeSolDate(d("2026-02-01T00:00:00Z"), { amount: 1, unit: "MONTHS" }))).toBe(
      "2026-03-01",
    );
    expect(key(computeSolDate(d("2026-08-31T00:00:00Z"), { amount: 6, unit: "MONTHS" }))).toBe(
      "2027-02-28",
    );
    expect(key(computeSolDate(d("2026-01-15T00:00:00Z"), { amount: 18, unit: "MONTHS" }))).toBe(
      "2027-07-15",
    );
  });

  test("days are plain day counts (crossing a leap day)", () => {
    expect(key(computeSolDate(d("2026-02-01T00:00:00Z"), { amount: 30, unit: "DAYS" }))).toBe(
      "2026-03-03",
    );
    expect(key(computeSolDate(d("2028-02-28T00:00:00Z"), { amount: 2, unit: "DAYS" }))).toBe(
      "2028-03-01",
    );
    expect(key(computeSolDate(d("2026-01-15T00:00:00Z"), { amount: 180, unit: "DAYS" }))).toBe(
      "2026-07-14",
    );
  });

  test("keeps UTC midnight and is independent of the process time zone (Denver + UTC)", () => {
    const prevTz = process.env.TZ;
    try {
      for (const tz of ["America/Denver", "America/Chicago", "UTC", "Pacific/Auckland"]) {
        process.env.TZ = tz;
        // Spans spring-forward in the US zones.
        expect(
          computeSolDate(d("2026-01-15T00:00:00Z"), { amount: 180, unit: "DAYS" })!.toISOString(),
        ).toBe("2026-07-14T00:00:00.000Z");
        expect(
          computeSolDate(d("2024-02-29T00:00:00Z"), { amount: 1, unit: "YEARS" })!.toISOString(),
        ).toBe("2025-02-28T00:00:00.000Z");
        expect(
          computeSolDate(d("2026-03-08T00:00:00Z"), { amount: 1, unit: "MONTHS" })!.toISOString(),
        ).toBe("2026-04-08T00:00:00.000Z");
        expect(
          computeSolDate(d("2026-10-31T00:00:00Z"), { amount: 1, unit: "YEARS" })!.toISOString(),
        ).toBe("2027-10-31T00:00:00.000Z");
      }
    } finally {
      if (prevTz === undefined) delete process.env.TZ;
      else process.env.TZ = prevTz;
    }
  });

  test("returns null when incident or period is missing", () => {
    expect(computeSolDate(null, Y2)).toBeNull();
    expect(computeSolDate(undefined, Y2)).toBeNull();
    const incident = d("2024-01-01");
    expect(computeSolDate(incident, null)).toBeNull();
    expect(computeSolDate(incident, undefined)).toBeNull();
    expect(computeSolDate(incident, { amount: 0, unit: "DAYS" })).toBeNull();
    expect(computeSolDate(incident, { amount: -10, unit: "DAYS" })).toBeNull();
  });

  test("doesn't mutate the input date", () => {
    const incident = d("2024-01-01");
    const before = incident.getTime();
    computeSolDate(incident, { amount: 1, unit: "YEARS" });
    computeSolDate(incident, { amount: 3, unit: "DAYS" });
    expect(incident.getTime()).toBe(before);
  });
});

describe("formatStatutePeriod", () => {
  test("null/zero -> 'Not configured'", () => {
    expect(formatStatutePeriod(null)).toBe("Not configured");
    expect(formatStatutePeriod({ amount: 0, unit: "DAYS" })).toBe("Not configured");
  });

  test("singular and plural per unit", () => {
    expect(formatStatutePeriod({ amount: 1, unit: "YEARS" })).toBe("1 year");
    expect(formatStatutePeriod({ amount: 2, unit: "YEARS" })).toBe("2 years");
    expect(formatStatutePeriod({ amount: 1, unit: "MONTHS" })).toBe("1 month");
    expect(formatStatutePeriod({ amount: 18, unit: "MONTHS" })).toBe("18 months");
    expect(formatStatutePeriod({ amount: 1, unit: "DAYS" })).toBe("1 day");
    expect(formatStatutePeriod({ amount: 180, unit: "DAYS" })).toBe("180 days");
  });
});
