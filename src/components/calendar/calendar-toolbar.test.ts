/**
 * Tests for the toolbar's "Today" focal computation.
 *
 * The regression worth pinning: "Today" used to be
 * `startOfDay(new Date())`, which resolves in the *server's* TZ.
 * On a UTC production box a user in America/Denver clicking Today
 * between 6pm and midnight local was sent to tomorrow's date.
 * `todayFocalInTz` must resolve the calendar date in the *user's*
 * TZ and round-trip losslessly through `toDateParam`.
 */

import { describe, expect, test, vi } from "vitest";

// The toolbar resolves the user's TZ via a server-only module
// (prisma + `server-only`); mock it so importing the pure helper
// doesn't pull server-only code into the test environment.
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "America/Denver"),
}));

import { parseISO } from "date-fns";
import { formatRangeLabel, todayFocalInTz } from "./calendar-toolbar";
import { toDateParam } from "@/lib/calendar-utils";

describe("formatRangeLabel", () => {
  // focal is built the way parseCalendarParams builds it: server-local
  // midnight of the ?d= key.
  const focal = (key: string) => parseISO(key);

  test("day view names the focal day itself", () => {
    expect(formatRangeLabel("day", focal("2026-07-15"), "America/Denver")).toBe(
      "Wednesday, July 15, 2026"
    );
  });

  test("week view within one month", () => {
    // The week of Wed Jul 15 runs Sun Jul 12 - Sat Jul 18.
    expect(formatRangeLabel("week", focal("2026-07-15"), "America/Denver")).toBe(
      "Week of Jul 12, 2026"
    );
  });

  test("week view straddling a month boundary shows both ends", () => {
    // Sun Jun 28 - Sat Jul 4.
    expect(formatRangeLabel("week", focal("2026-07-01"), "America/Denver")).toBe(
      "Jun 28 – Jul 4, 2026"
    );
  });

  test("month view on the 1st names that month, not the previous one", () => {
    // The Next-month arrow lands on the 1st — the label must be the
    // month the grid shows.
    for (const tz of ["America/Denver", "UTC", "Asia/Tokyo"]) {
      expect(formatRangeLabel("month", focal("2026-08-01"), tz)).toBe(
        "August 2026"
      );
    }
  });

  test("the label agrees with the grid week, not a re-derived one", () => {
    // Sunday focal: the week STARTS on it (the grid builder is
    // Sunday-first), so the label must not slide back a week.
    expect(formatRangeLabel("week", focal("2026-07-12"), "America/Denver")).toBe(
      "Week of Jul 12, 2026"
    );
  });
});

describe("todayFocalInTz", () => {
  test("late evening west of UTC stays on the user's calendar day", () => {
    // 2026-07-07T03:30Z is 9:30pm on July 6 in Denver (UTC-6, MDT).
    // The old server-TZ code on a UTC box would have said July 7.
    const now = new Date("2026-07-07T03:30:00Z");
    expect(toDateParam(todayFocalInTz(now, "America/Denver"))).toBe(
      "2026-07-06"
    );
  });

  test("early morning east of UTC rolls forward to the user's day", () => {
    // 2026-07-06T22:30Z is already 7:30am on July 7 in Tokyo (UTC+9).
    const now = new Date("2026-07-06T22:30:00Z");
    expect(toDateParam(todayFocalInTz(now, "Asia/Tokyo"))).toBe("2026-07-07");
  });

  test("round-trips through toDateParam for a midday instant", () => {
    // Noon UTC is the same calendar day in every inhabited zone —
    // the helper and the URL serializer must agree on it.
    const now = new Date("2026-07-06T12:00:00Z");
    for (const tz of ["America/Denver", "UTC", "Asia/Tokyo"]) {
      expect(toDateParam(todayFocalInTz(now, tz))).toBe("2026-07-06");
    }
  });
});
