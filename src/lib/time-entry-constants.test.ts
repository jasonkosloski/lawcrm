/**
 * Unit tests for the time-entry helpers: timer rounding (UP to the
 * quarter-hour billing increment, minimum one increment), elapsed
 * formatting, start–end hour computation, and the UTBMS catalog
 * shape + validation guard.
 */

import { describe, expect, test } from "vitest";
import {
  TIME_ENTRY_INCREMENT_HOURS,
  UTBMS_ACTIVITY_CODES,
  UTBMS_LITIGATION_TASK_CODES,
  computeHoursFromTimeRange,
  formatElapsed,
  isKnownUtbmsCode,
  roundElapsedToBillingIncrement,
  utbmsCodeLabel,
} from "./time-entry-constants";

const HOUR_MS = 3_600_000;

describe("roundElapsedToBillingIncrement", () => {
  test("rounds UP to the next quarter-hour", () => {
    // 1h01m is past 4 increments → bills as 1.25.
    expect(roundElapsedToBillingIncrement(HOUR_MS + 60_000)).toBe(1.25);
  });

  test("exact increments don't round up an extra step", () => {
    expect(roundElapsedToBillingIncrement(1.5 * HOUR_MS)).toBe(1.5);
  });

  test("a few seconds bill as the minimum one increment", () => {
    expect(roundElapsedToBillingIncrement(30_000)).toBe(
      TIME_ENTRY_INCREMENT_HOURS
    );
  });

  test("zero / negative / NaN clamp to the minimum increment", () => {
    // Clock skew (startedAt in the future) must not produce a 0 or
    // negative prefill the server would reject.
    expect(roundElapsedToBillingIncrement(0)).toBe(TIME_ENTRY_INCREMENT_HOURS);
    expect(roundElapsedToBillingIncrement(-5000)).toBe(
      TIME_ENTRY_INCREMENT_HOURS
    );
    expect(roundElapsedToBillingIncrement(Number.NaN)).toBe(
      TIME_ENTRY_INCREMENT_HOURS
    );
  });
});

describe("formatElapsed", () => {
  test("formats hours/minutes/seconds with padded mm:ss", () => {
    expect(formatElapsed(HOUR_MS + 3 * 60_000 + 9_000)).toBe("1:03:09");
  });

  test("sub-minute durations", () => {
    expect(formatElapsed(42_000)).toBe("0:00:42");
  });

  test("negative / non-finite render as zero", () => {
    expect(formatElapsed(-1000)).toBe("0:00:00");
    expect(formatElapsed(Number.NaN)).toBe("0:00:00");
  });
});

describe("computeHoursFromTimeRange", () => {
  test("computes decimal hours for a same-day range", () => {
    expect(computeHoursFromTimeRange("09:00", "10:30")).toBe(1.5);
  });

  test("rounds to 2 decimals (20 minutes → 0.33)", () => {
    expect(computeHoursFromTimeRange("09:00", "09:20")).toBe(0.33);
  });

  test("end before or equal to start → null (no overnight inference)", () => {
    expect(computeHoursFromTimeRange("14:00", "13:00")).toBeNull();
    expect(computeHoursFromTimeRange("14:00", "14:00")).toBeNull();
  });

  test("missing or malformed inputs → null", () => {
    expect(computeHoursFromTimeRange("", "10:00")).toBeNull();
    expect(computeHoursFromTimeRange("09:00", "")).toBeNull();
    expect(computeHoursFromTimeRange("9am", "10:00")).toBeNull();
    expect(computeHoursFromTimeRange("25:00", "26:00")).toBeNull();
  });
});

describe("UTBMS catalog", () => {
  test("activity set has the 11 standard A-codes", () => {
    expect(UTBMS_ACTIVITY_CODES.map((c) => c.code)).toEqual([
      "A101", "A102", "A103", "A104", "A105", "A106",
      "A107", "A108", "A109", "A110", "A111",
    ]);
  });

  test("litigation task codes are L-prefixed and unique", () => {
    const codes = UTBMS_LITIGATION_TASK_CODES.map((c) => c.code);
    expect(codes.every((c) => /^L\d{3}$/.test(c))).toBe(true);
    expect(new Set(codes).size).toBe(codes.length);
  });

  test("isKnownUtbmsCode accepts catalog codes and rejects junk", () => {
    expect(isKnownUtbmsCode("A103")).toBe(true);
    expect(isKnownUtbmsCode("L330")).toBe(true);
    expect(isKnownUtbmsCode("X999")).toBe(false);
    expect(isKnownUtbmsCode("")).toBe(false);
  });

  test("utbmsCodeLabel joins code + label, falls back to bare code", () => {
    expect(utbmsCodeLabel("A103")).toBe("A103 — Draft/revise");
    expect(utbmsCodeLabel("Z000")).toBe("Z000");
  });
});
