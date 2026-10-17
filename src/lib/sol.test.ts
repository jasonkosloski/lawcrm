/**
 * Tests for SOL helpers — pure functions, no DB.
 *
 * Coverage targets:
 *   - packStatuteDays: y/m/d → total days conversion (legal
 *     365/30 convention).
 *   - unpackStatuteDays: round-trip + greedy decomposition.
 *   - computeSolDate: date arithmetic, null handling.
 *   - formatStatutePeriod: "2 years" / multi-unit / not-configured.
 */

import { describe, expect, test } from "vitest";
import {
  computeSolDate,
  formatStatutePeriod,
  isAutoDerivedSol,
  packStatuteDays,
  parseSolDateInput,
  resolveEditedSolDate,
  unpackStatuteDays,
} from "./sol";

const d = (s: string) => new Date(s);
const key = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);

describe("parseSolDateInput", () => {
  test("parses a valid date to UTC midnight (same instant as new Date)", () => {
    expect(parseSolDateInput("2026-06-01")?.toISOString()).toBe(
      "2026-06-01T00:00:00.000Z"
    );
    expect(parseSolDateInput("2024-02-29")).not.toBeNull();
  });
  test("rejects malformed and non-existent days", () => {
    for (const bad of ["", "garbage", "2026-6-1", "2026-02-31", "2025-02-29", "2026-13-01", "2026-06-01T00:00"]) {
      expect(parseSolDateInput(bad)).toBeNull();
    }
  });
});

describe("isAutoDerivedSol", () => {
  test("null SOL is auto; matching computed is auto; anything else is manual", () => {
    expect(isAutoDerivedSol({ storedSol: null, storedIncident: null, storedPeriodDays: null })).toBe(true);
    expect(isAutoDerivedSol({ storedSol: d("2026-06-01"), storedIncident: d("2024-06-01"), storedPeriodDays: 730 })).toBe(true);
    expect(isAutoDerivedSol({ storedSol: d("2027-01-15"), storedIncident: d("2024-06-01"), storedPeriodDays: 730 })).toBe(false);
    // Cannot be computed -> treated as a manual date (kept, never recomputed).
    expect(isAutoDerivedSol({ storedSol: d("2026-06-01"), storedIncident: null, storedPeriodDays: 730 })).toBe(false);
  });
});

describe("resolveEditedSolDate", () => {
  const base = {
    storedIncident: d("2024-06-01"),
    storedPeriodDays: 730,
    periodDays: 730,
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
      periodDays: 365,
      posted: d("2026-06-01"),
      stored: d("2026-06-01"),
      incident: d("2024-06-01"),
    });
    expect(key(out)).toBe("2025-06-01");
  });
  test("moving to an area with no configured period keeps the stored date rather than dropping it", () => {
    const out = resolveEditedSolDate({
      ...base,
      periodDays: null,
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
      })
    ).toBeNull();
  });
});

describe("packStatuteDays", () => {
  test("plain 2 years = 730 days", () => {
    expect(packStatuteDays({ years: 2, months: 0, days: 0 })).toBe(730);
  });

  test("1 year + 6 months + 15 days = 365 + 180 + 15", () => {
    expect(packStatuteDays({ years: 1, months: 6, days: 15 })).toBe(560);
  });

  test("zero across the board → 0", () => {
    expect(packStatuteDays({ years: 0, months: 0, days: 0 })).toBe(0);
  });

  test("negative inputs coerce to zero (no error)", () => {
    expect(packStatuteDays({ years: -1, months: -2, days: -3 })).toBe(0);
  });

  test("fractional inputs floor to integers", () => {
    expect(packStatuteDays({ years: 1.9, months: 0, days: 0 })).toBe(365);
  });

  test("round-trip pack/unpack on clean inputs", () => {
    const period = { years: 3, months: 4, days: 5 };
    expect(unpackStatuteDays(packStatuteDays(period))).toEqual(period);
  });
});

describe("unpackStatuteDays", () => {
  test("null/0/negative → all zeros", () => {
    expect(unpackStatuteDays(null)).toEqual({ years: 0, months: 0, days: 0 });
    expect(unpackStatuteDays(0)).toEqual({ years: 0, months: 0, days: 0 });
    expect(unpackStatuteDays(-100)).toEqual({ years: 0, months: 0, days: 0 });
  });

  test("greedy decomposition prefers years over months", () => {
    expect(unpackStatuteDays(730)).toEqual({ years: 2, months: 0, days: 0 });
    // 24 months would be valid math but reads worse; want years.
    expect(unpackStatuteDays(720)).toEqual({ years: 1, months: 11, days: 25 });
  });

  test("under one year stays in months/days", () => {
    expect(unpackStatuteDays(60)).toEqual({ years: 0, months: 2, days: 0 });
    expect(unpackStatuteDays(45)).toEqual({ years: 0, months: 1, days: 15 });
  });
});

describe("computeSolDate", () => {
  test("incident + 730 days = SOL 2 years out", () => {
    const incident = new Date("2024-04-15T12:00:00Z");
    const sol = computeSolDate(incident, 730);
    expect(sol).not.toBeNull();
    // 730 days exactly — ignore TZ on this assertion by going
    // through ISO date (date arithmetic is what matters).
    expect(sol!.toISOString().slice(0, 10)).toBe("2026-04-15");
  });

  test("pins the documented 365/30 day-count convention across a leap year (F093/F945)", () => {
    // KNOWN LIMITATION: "2 years" is 730 days, so a window spanning
    // Feb 29 lands one day BEFORE the calendar anniversary
    // (2029-03-10). Changing this needs the {years, months, days}
    // schema change (Batch 4) — update this test with it.
    const sol = computeSolDate(new Date("2027-03-10T00:00:00Z"), 730);
    expect(sol!.toISOString().slice(0, 10)).toBe("2029-03-09");
    // "1 month" = 30 days: Feb 1 + 30 = Mar 3 (calendar: Mar 1).
    const month = computeSolDate(new Date("2026-02-01T00:00:00Z"), 30);
    expect(month!.toISOString().slice(0, 10)).toBe("2026-03-03");
  });

  test("UTC-midnight incident crossing a DST boundary stays on the calendar day", () => {
    // Incident dates arrive as UTC-midnight timestamps. Local-time
    // setDate() in a DST-observing server zone used to land the
    // result at 23:00Z of the PREVIOUS day when the statute period
    // crossed spring-forward — a silent one-day-early SOL date.
    // Pin TZ to a DST zone so the regression reproduces regardless
    // of the machine running the suite (Node re-reads TZ at runtime).
    const prevTz = process.env.TZ;
    process.env.TZ = "America/Chicago"; // spring-forward 2026-03-08
    try {
      const incident = new Date("2026-01-15T00:00:00Z");
      const sol = computeSolDate(incident, 180);
      expect(sol!.toISOString()).toBe("2026-07-14T00:00:00.000Z");
    } finally {
      if (prevTz === undefined) delete process.env.TZ;
      else process.env.TZ = prevTz;
    }
  });

  test("returns null when incident is missing", () => {
    expect(computeSolDate(null, 730)).toBeNull();
    expect(computeSolDate(undefined, 730)).toBeNull();
  });

  test("returns null when statute period is missing or zero", () => {
    const incident = new Date("2024-01-01");
    expect(computeSolDate(incident, null)).toBeNull();
    expect(computeSolDate(incident, undefined)).toBeNull();
    expect(computeSolDate(incident, 0)).toBeNull();
    // Negative is treated as misconfiguration, not "subtract days."
    expect(computeSolDate(incident, -10)).toBeNull();
  });

  test("doesn't mutate the input date", () => {
    const incident = new Date("2024-01-01");
    const before = incident.getTime();
    computeSolDate(incident, 365);
    expect(incident.getTime()).toBe(before);
  });
});

describe("formatStatutePeriod", () => {
  test("null/0 → 'Not configured'", () => {
    expect(formatStatutePeriod(null)).toBe("Not configured");
    expect(formatStatutePeriod(0)).toBe("Not configured");
  });

  test("clean unit boundaries", () => {
    expect(formatStatutePeriod(365)).toBe("1 year");
    expect(formatStatutePeriod(730)).toBe("2 years");
    expect(formatStatutePeriod(30)).toBe("1 month");
    expect(formatStatutePeriod(60)).toBe("2 months");
    expect(formatStatutePeriod(1)).toBe("1 day");
    expect(formatStatutePeriod(7)).toBe("7 days");
  });

  test("composite reads in greatest-unit-first order", () => {
    expect(formatStatutePeriod(395)).toBe("1 year 1 month");
    expect(formatStatutePeriod(396)).toBe("1 year 1 month 1 day");
  });
});
