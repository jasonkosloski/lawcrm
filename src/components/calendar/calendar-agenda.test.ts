/**
 * Agenda rail — time-label unit tests.
 *
 * Pins the TZ-correctness of `agendaTimeLabel`: the rail buckets
 * items into day groups in the USER's TZ, so the per-row time must
 * render in that same TZ. A regression to server-local formatting
 * (date-fns `format`) would pass on a dev machine in the user's TZ
 * but shift every time by the UTC offset in production.
 */

import { describe, expect, it, vi } from "vitest";

// calendar-agenda.tsx is a server component — its import graph pulls
// `server-only` + Prisma via the TZ getter and the calendar queries.
// Mock both so the pure helper is importable in the unit environment.
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "America/Denver"),
}));
vi.mock("@/lib/queries/calendar", () => ({
  getCalendarItems: vi.fn(async () => []),
}));

import { agendaTimeLabel } from "./calendar-agenda";

describe("agendaTimeLabel", () => {
  // 2026-07-06T21:30:00Z — 3:30 PM in Denver (MDT, UTC-6),
  // 5:30 PM in New York (EDT, UTC-4).
  const instant = new Date("2026-07-06T21:30:00.000Z");

  it("formats in the user's TZ, not the server's", () => {
    expect(agendaTimeLabel(instant, false, "America/Denver")).toBe("3:30pm");
    // Same instant, different user TZ → different label. Pins that
    // the TZ arg is actually threaded through to Intl.
    expect(agendaTimeLabel(instant, false, "America/New_York")).toBe(
      "5:30pm"
    );
  });

  it("stays on the user's calendar day across UTC midnight", () => {
    // 02:00 UTC July 7 is still 8:00 PM July 6 in Denver — the day
    // grouping puts this under the July 6 heading, so the label must
    // agree (the old server-TZ format would have said "2:00am" on a
    // UTC production server).
    const lateEvening = new Date("2026-07-07T02:00:00.000Z");
    expect(agendaTimeLabel(lateEvening, false, "America/Denver")).toBe(
      "8:00pm"
    );
  });

  it("returns 'All day' for all-day events regardless of TZ", () => {
    expect(agendaTimeLabel(instant, true, "America/Denver")).toBe("All day");
    expect(agendaTimeLabel(instant, true, "Pacific/Auckland")).toBe("All day");
  });

  it("emits the compact lowercase form that fits the w-12 time column", () => {
    const label = agendaTimeLabel(instant, false, "America/Denver");
    // No whitespace (incl. Intl's narrow no-break space) and no
    // uppercase dayperiod — "3:30pm", not "3:30 PM".
    expect(label).not.toMatch(/\s/);
    expect(label).toBe(label.toLowerCase());
  });
});
