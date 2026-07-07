/**
 * Month view — time-label TZ correctness.
 *
 * MonthView is a server component, so any TZ-naive formatting runs
 * in the *server's* zone (UTC in production). These tests pin the
 * fix: pill hour labels come from `compactHourInTz`, anchored to
 * the user's IANA TZ regardless of where the process runs. Vitest
 * itself may run in any host TZ — the assertions below only hold
 * because the helper ignores the runtime zone.
 */

import { describe, it, expect } from "vitest";
import { compactHourInTz } from "./month-view";

describe("compactHourInTz", () => {
  it("renders the hour in the user's TZ, not the runtime's", () => {
    // 15:00 UTC is 9:00am in Denver (MDT, UTC-6). On a UTC server a
    // TZ-naive format would say "3pm" — the original bug.
    const start = new Date("2026-07-06T15:00:00Z");
    expect(compactHourInTz(start, "America/Denver")).toBe("9am");
    expect(compactHourInTz(start, "UTC")).toBe("3pm");
  });

  it("drops minutes — pill shows the hour only", () => {
    const start = new Date("2026-07-06T15:30:00Z");
    expect(compactHourInTz(start, "America/Denver")).toBe("9am");
  });

  it("handles noon and midnight in the user's TZ", () => {
    // 06:00 UTC = midnight in Denver; 18:00 UTC = noon.
    expect(
      compactHourInTz(new Date("2026-07-06T06:00:00Z"), "America/Denver")
    ).toBe("12am");
    expect(
      compactHourInTz(new Date("2026-07-06T18:00:00Z"), "America/Denver")
    ).toBe("12pm");
  });

  it("respects DST — a standard-time instant shifts by an hour", () => {
    // Denver is UTC-7 in January (MST): 15:00 UTC = 8am.
    expect(
      compactHourInTz(new Date("2026-01-06T15:00:00Z"), "America/Denver")
    ).toBe("8am");
  });
});
