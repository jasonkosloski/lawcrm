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
  calendarMonthGridInTz,
  calendarWeekInTz,
  dateKeyInTz,
  formatDate,
  formatDayBucket,
  formatRelative,
  instantInTz,
  parseLocalDate,
  parseLocalDateOrDateTime,
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

  // 2026-04-15 is a Wednesday — the weekday variants below hang off it.
  test("short_weekday adds the weekday, omits the year", () => {
    const out = formatDate(
      new Date("2026-04-15T12:00:00Z"),
      "short_weekday",
      "UTC"
    );
    expect(out).toMatch(/Wed/);
    expect(out).toMatch(/Apr/);
    expect(out).toMatch(/15/);
    expect(out).not.toMatch(/2026/);
  });

  test("full_short: short weekday + short month + year", () => {
    const out = formatDate(
      new Date("2026-04-15T12:00:00Z"),
      "full_short",
      "UTC"
    );
    expect(out).toMatch(/Wed/);
    expect(out).toMatch(/Apr/);
    expect(out).not.toMatch(/April/);
    expect(out).toMatch(/2026/);
  });

  test("full_long: long weekday + long month + year", () => {
    const out = formatDate(
      new Date("2026-04-15T12:00:00Z"),
      "full_long",
      "UTC"
    );
    expect(out).toMatch(/Wednesday/);
    expect(out).toMatch(/April/);
    expect(out).toMatch(/2026/);
  });

  test("datetime_medium adds the year to datetime", () => {
    const out = formatDate(
      new Date("2026-04-15T14:30:00Z"),
      "datetime_medium",
      "UTC"
    );
    expect(out).toMatch(/Apr/);
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/2:30/);
  });
});

describe("parseLocalDate", () => {
  test("parses YYYY-MM-DD to LOCAL midnight (not UTC)", () => {
    const d = parseLocalDate("2026-04-15");
    expect(d).not.toBeNull();
    // Local getters must read back the same calendar day — the
    // whole point of the helper. `new Date("2026-04-15")` would
    // fail this in any environment west of UTC.
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(3);
    expect(d!.getDate()).toBe(15);
    expect(d!.getHours()).toBe(0);
    expect(d!.getMinutes()).toBe(0);
  });

  test("rejects malformed values instead of yielding Invalid Date", () => {
    expect(parseLocalDate("")).toBeNull();
    expect(parseLocalDate("abc")).toBeNull();
    expect(parseLocalDate("2026-4-5")).toBeNull(); // needs zero-padding
    expect(parseLocalDate("2026-04-15T12:00")).toBeNull(); // datetime not allowed
  });
});

describe("parseLocalDateOrDateTime", () => {
  test("date-only goes through the local-midnight path", () => {
    const d = parseLocalDateOrDateTime("2026-04-15");
    expect(d!.getDate()).toBe(15);
    expect(d!.getHours()).toBe(0);
  });

  test("datetime-local strings parse as local wall-clock time", () => {
    const d = parseLocalDateOrDateTime("2026-04-15T13:30");
    expect(d!.getDate()).toBe(15);
    expect(d!.getHours()).toBe(13);
    expect(d!.getMinutes()).toBe(30);
  });

  test("full ISO instants keep their exact moment", () => {
    const d = parseLocalDateOrDateTime("2026-04-15T13:30:00.000Z");
    expect(d!.getTime()).toBe(Date.parse("2026-04-15T13:30:00.000Z"));
  });

  test("garbage returns null", () => {
    expect(parseLocalDateOrDateTime("not a date")).toBeNull();
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

  // The bucket must follow the USER's calendar days when tz is
  // given — the exact production failure the file header warns
  // about (UTC server, non-UTC user around midnight).
  describe("tz-anchored buckets", () => {
    // Monday April 27, 9:00am MDT.
    const now = new Date("2026-04-27T15:00:00Z");

    test("late-evening local entry stays 'Yesterday' even when UTC has rolled to today", () => {
      // 2026-04-27T04:00:00Z = Sunday April 26, 10:00pm MDT — same
      // UTC calendar day as `now`, but the prior day in Denver.
      const lateSunday = new Date("2026-04-27T04:00:00Z");
      expect(
        formatDayBucket(lateSunday, { now, tz: "America/Denver" })
      ).toBe("Yesterday");
      expect(formatDayBucket(lateSunday, { now, tz: "UTC" })).toBe("Today");
    });

    test("east-of-UTC: same-UTC-day instant already 'Yesterday' in Tokyo", () => {
      // `now` is April 28 00:00 in Tokyo (UTC+9); April 27 14:00 UTC
      // is 11:00pm April 27 Tokyo — the previous Tokyo day.
      const entry = new Date("2026-04-27T14:00:00Z");
      expect(formatDayBucket(entry, { now, tz: "Asia/Tokyo" })).toBe(
        "Yesterday"
      );
      expect(formatDayBucket(entry, { now, tz: "UTC" })).toBe("Today");
    });

    test("bucket and weekday label agree in the user's TZ", () => {
      // 2026-04-25T05:00:00Z = Friday April 24, 11:00pm MDT. Denver
      // sees 3 days back → within-week branch, and the label must
      // say Friday (the Denver weekday), not Saturday (the UTC one).
      const entry = new Date("2026-04-25T05:00:00Z");
      expect(formatDayBucket(entry, { now, tz: "America/Denver" })).toBe(
        "Friday"
      );
    });
  });
});

// ── TZ helpers ─────────────────────────────────────────────────────────
//
// These cover the bug we just hit on production: dragging a calendar
// event in a non-UTC browser landed it on the wrong calendar day
// because the day Dates were UTC midnights. Each test pins a specific
// behavior so a future "let's just use date-fns directly" regression
// trips the suite.

describe("dateKeyInTz", () => {
  test("a UTC instant before local midnight resolves to the previous day in a west-of-UTC TZ", () => {
    // 2026-04-26T00:00:00.000Z = Saturday April 25 6pm MDT.
    const d = new Date("2026-04-26T00:00:00.000Z");
    expect(dateKeyInTz(d, "America/Denver")).toBe("2026-04-25");
  });

  test("the same instant resolves to the next day in an east-of-UTC TZ", () => {
    const d = new Date("2026-04-26T00:00:00.000Z");
    expect(dateKeyInTz(d, "Asia/Tokyo")).toBe("2026-04-26");
    // 23:00 UTC on the 25th is already the 26th in Tokyo (UTC+9).
    const d2 = new Date("2026-04-25T23:00:00.000Z");
    expect(dateKeyInTz(d2, "Asia/Tokyo")).toBe("2026-04-26");
  });

  test("UTC TZ is identity-ish — instant's UTC date is the key", () => {
    expect(dateKeyInTz(new Date("2026-04-26T12:00:00.000Z"), "UTC")).toBe(
      "2026-04-26"
    );
  });
});

describe("instantInTz", () => {
  test("midnight in MDT (UTC-6) is 6am UTC", () => {
    // April is in MDT (DST), UTC-6.
    const d = instantInTz(2026, 4, 26, 0, 0, "America/Denver");
    expect(d.toISOString()).toBe("2026-04-26T06:00:00.000Z");
  });

  test("midnight in MST (UTC-7) is 7am UTC — outside DST", () => {
    // January is MST, UTC-7.
    const d = instantInTz(2026, 1, 15, 0, 0, "America/Denver");
    expect(d.toISOString()).toBe("2026-01-15T07:00:00.000Z");
  });

  test("midnight in Tokyo (UTC+9) is 3pm prior day UTC", () => {
    const d = instantInTz(2026, 4, 26, 0, 0, "Asia/Tokyo");
    expect(d.toISOString()).toBe("2026-04-25T15:00:00.000Z");
  });

  test("DST 'spring forward' day — 2am Denver doesn't exist (skipped); we land deterministically", () => {
    // March 8, 2026 — second Sunday of March, US DST starts. Clocks
    // jump from 1:59:59 MST to 3:00:00 MDT, so 2:30am locally never
    // happens. Different Intl iteration paths can land at:
    //   - 08:30 UTC = 2:30am MDT (post-jump, treats wall clock as MDT)
    //   - 09:30 UTC = 2:30am MST (pre-jump, treats wall clock as MST)
    //   - 10:30 UTC = 3:30am MDT (steps forward through the gap)
    // We don't promise WHICH; only that the result is a valid
    // instant in the morning hours and the function doesn't throw
    // or hang.
    const d = instantInTz(2026, 3, 8, 2, 30, "America/Denver");
    expect(Number.isFinite(d.getTime())).toBe(true);
    const isoHour = d.toISOString().slice(11, 13);
    expect(["08", "09", "10"]).toContain(isoHour);
  });

  test("DST 'fall back' day — 1:30am Denver is ambiguous; we land deterministically", () => {
    // November 1, 2026 — first Sunday of November, US DST ends.
    // Clocks jump back from 1:59:59 MDT to 1:00:00 MST. 1:30am
    // happens twice. Intl picks one consistently — we just verify
    // we get *a* valid UTC instant for the chosen interpretation.
    const d = instantInTz(2026, 11, 1, 1, 30, "America/Denver");
    expect(Number.isFinite(d.getTime())).toBe(true);
    // 1:30am MDT = 07:30 UTC; 1:30am MST = 08:30 UTC.
    const isoHour = d.toISOString().slice(11, 13);
    expect(["07", "08"]).toContain(isoHour);
  });
});

describe("calendarWeekInTz", () => {
  test("focal mid-week returns Sun-Sat days, all noon UTC", () => {
    // Tuesday April 28 in MDT.
    const focal = new Date("2026-04-28T15:00:00.000Z");
    const { days } = calendarWeekInTz(focal, "America/Denver");
    expect(days).toHaveLength(7);
    // First day = Sunday April 26, noon UTC.
    expect(days[0]!.toISOString()).toBe("2026-04-26T12:00:00.000Z");
    // Last day = Saturday May 2, noon UTC.
    expect(days[6]!.toISOString()).toBe("2026-05-02T12:00:00.000Z");
  });

  test("range covers Sunday 00:00 → Saturday 23:59 in user TZ", () => {
    const focal = new Date("2026-04-28T15:00:00.000Z");
    const { rangeStart, rangeEnd } = calendarWeekInTz(
      focal,
      "America/Denver"
    );
    // Sunday April 26 midnight MDT = 06:00 UTC.
    expect(rangeStart.toISOString()).toBe("2026-04-26T06:00:00.000Z");
    // Saturday May 2 23:59 MDT = May 3 05:59 UTC.
    expect(rangeEnd.toISOString()).toBe("2026-05-03T05:59:00.000Z");
  });

  test("east-of-UTC TZ shifts the range the other direction", () => {
    const focal = new Date("2026-04-28T15:00:00.000Z");
    const { rangeStart } = calendarWeekInTz(focal, "Asia/Tokyo");
    // Sunday April 26 midnight Tokyo (UTC+9) = April 25 15:00 UTC.
    expect(rangeStart.toISOString()).toBe("2026-04-25T15:00:00.000Z");
  });

  test("focal that's Saturday late-evening MDT still returns this week (not next)", () => {
    // Saturday May 2, 11:30pm MDT = May 3 05:30 UTC.
    // The user calls this "Saturday May 2" — the week should
    // be April 26 through May 2.
    const focal = new Date("2026-05-03T05:30:00.000Z");
    const { days } = calendarWeekInTz(focal, "America/Denver");
    expect(days[0]!.getUTCDate()).toBe(26); // Sunday April 26
    expect(days[6]!.getUTCDate()).toBe(2); // Saturday May 2
  });
});

describe("calendarMonthGridInTz", () => {
  test("April 2026 grid starts on Sunday March 29 (the prior week's Sunday)", () => {
    // April 2026: the 1st is a Wednesday, so the grid starts on
    // Sunday March 29.
    const focal = new Date("2026-04-15T15:00:00.000Z");
    const { days } = calendarMonthGridInTz(focal, "America/Denver");
    expect(days).toHaveLength(42);
    expect(days[0]!.toISOString()).toBe("2026-03-29T12:00:00.000Z");
    // Last day = Saturday May 9 (the trailing week's Saturday).
    expect(days[41]!.toISOString()).toBe("2026-05-09T12:00:00.000Z");
  });

  test("range bounds respect user TZ", () => {
    const focal = new Date("2026-04-15T15:00:00.000Z");
    const { rangeStart, rangeEnd } = calendarMonthGridInTz(
      focal,
      "America/Denver"
    );
    // Sunday March 29 midnight MDT = 06:00 UTC.
    expect(rangeStart.toISOString()).toBe("2026-03-29T06:00:00.000Z");
    // Saturday May 9 23:59 MDT = May 10 05:59 UTC.
    expect(rangeEnd.toISOString()).toBe("2026-05-10T05:59:00.000Z");
  });
});
