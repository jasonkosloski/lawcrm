/**
 * Tests for the centralized date formatter.
 *
 * Most assertions use `toContain` / regex rather than equality
 * because Intl output is locale-stable but spacing / punctuation
 * varies subtly across Node versions. Concrete bits we DO assert:
 *   - null returns the "—" placeholder
 *   - the right month / day / time components surface
 *   - the iso variant produces a YYYY-MM-DD string
 *   - relative buckets land in the right tier
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  formatDate,
  formatDayBucket,
  formatRelative,
} from "./format-date";

// Anchor "now" so relative-time assertions are stable.
const FROZEN_NOW = new Date("2026-04-27T15:00:00Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("formatDate", () => {
  test("null/undefined returns the placeholder", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
  });

  test("medium variant includes month-short, day, year", () => {
    const out = formatDate(new Date("2026-04-15T12:00:00Z"), "medium", "UTC");
    expect(out).toMatch(/Apr/);
    expect(out).toMatch(/15/);
    expect(out).toMatch(/2026/);
  });

  test("short omits the year", () => {
    const out = formatDate(new Date("2026-04-15T12:00:00Z"), "short", "UTC");
    expect(out).toMatch(/Apr/);
    expect(out).toMatch(/15/);
    expect(out).not.toMatch(/2026/);
  });

  test("long uses month-long", () => {
    const out = formatDate(new Date("2026-04-15T12:00:00Z"), "long", "UTC");
    expect(out).toMatch(/April/);
  });

  test("iso variant produces YYYY-MM-DD ignoring timezone", () => {
    // Use a date with non-zero UTC offset to confirm we're in UTC.
    expect(formatDate(new Date("2026-04-15T23:30:00Z"), "iso")).toBe(
      "2026-04-15"
    );
  });

  test("time variant renders hour + minute, no date", () => {
    const out = formatDate(new Date("2026-04-15T14:30:00Z"), "time", "UTC");
    expect(out).toMatch(/2:30/);
    expect(out).not.toMatch(/Apr/);
  });

  test("datetime combines month + day + time", () => {
    const out = formatDate(
      new Date("2026-04-15T14:30:00Z"),
      "datetime",
      "UTC"
    );
    expect(out).toMatch(/Apr/);
    expect(out).toMatch(/2:30/);
  });

  test("tz arg shifts time output", () => {
    const ts = new Date("2026-04-15T18:00:00Z");
    // 18:00 UTC = 14:00 EDT (UTC-4 with DST in April)
    const utc = formatDate(ts, "time", "UTC");
    const ny = formatDate(ts, "time", "America/New_York");
    expect(utc).not.toBe(ny);
    expect(ny).toMatch(/2:00/);
  });
});

describe("formatRelative — tier boundaries", () => {
  test("under a minute → 'just now'", () => {
    const recent = new Date(FROZEN_NOW - 30_000);
    expect(formatRelative(recent)).toBe("just now");
  });

  test("minutes tier", () => {
    const fiveMinAgo = new Date(FROZEN_NOW - 5 * 60_000);
    expect(formatRelative(fiveMinAgo)).toBe("5m ago");
  });

  test("hours tier", () => {
    const threeHoursAgo = new Date(FROZEN_NOW - 3 * 60 * 60_000);
    expect(formatRelative(threeHoursAgo)).toBe("3h ago");
  });

  test("'yesterday' for exactly one day ago", () => {
    const yesterday = new Date(FROZEN_NOW - 24 * 60 * 60_000);
    expect(formatRelative(yesterday)).toBe("yesterday");
  });

  test("days tier (2-6)", () => {
    const threeDaysAgo = new Date(FROZEN_NOW - 3 * 24 * 60 * 60_000);
    expect(formatRelative(threeDaysAgo)).toBe("3d ago");
  });

  test("weeks tier (1-4)", () => {
    const tenDaysAgo = new Date(FROZEN_NOW - 10 * 24 * 60 * 60_000);
    expect(formatRelative(tenDaysAgo)).toBe("1w ago");
  });

  test("older falls back to a calendar date", () => {
    const longAgo = new Date(FROZEN_NOW - 60 * 24 * 60 * 60_000);
    const out = formatRelative(longAgo, "UTC");
    // "Feb 26, 2026" or similar — has a month name + year.
    expect(out).toMatch(/2026/);
  });

  test("null returns the placeholder", () => {
    expect(formatRelative(null)).toBe("—");
  });
});

describe("formatDayBucket", () => {
  test("today vs yesterday named buckets", () => {
    const now = new Date(FROZEN_NOW);
    const today = new Date(FROZEN_NOW - 1 * 60 * 60_000); // earlier today
    const yesterday = new Date(FROZEN_NOW - 25 * 60 * 60_000);
    expect(formatDayBucket(today, { now })).toBe("Today");
    expect(formatDayBucket(yesterday, { now })).toBe("Yesterday");
  });

  test("within-week → weekday name", () => {
    const now = new Date("2026-04-27T15:00:00Z"); // Monday
    const threeDaysAgo = new Date("2026-04-24T12:00:00Z"); // Friday
    expect(formatDayBucket(threeDaysAgo, { now })).toMatch(/Friday/);
  });

  test("older than a week → calendar date", () => {
    const now = new Date(FROZEN_NOW);
    const tenDaysAgo = new Date(FROZEN_NOW - 10 * 24 * 60 * 60_000);
    const out = formatDayBucket(tenDaysAgo, { now, tz: "UTC" });
    // Includes month-short + day; year may or may not appear.
    expect(out).toMatch(/Apr/);
  });

  test("null returns the placeholder", () => {
    expect(formatDayBucket(null)).toBe("—");
  });
});
