/**
 * Tests for StatuteOfLimitationsCard — specifically the timezone
 * handling of the deadline countdown and date rendering.
 *
 * SOL / incident dates are date-only values stored as UTC midnight
 * (the server parses "YYYY-MM-DD" with `new Date(...)`). The card
 * must read them on the UTC day grid; the old local-time floor made
 * a stored 2026-07-10T00:00Z render as "Jul 9" for anyone west of
 * UTC and shorted the days-remaining math by one. These tests run
 * pinned to America/Denver (UTC-6 in July) to prove the corrected
 * behavior for exactly that class of user.
 */

// Must be set before anything touches Date — V8 caches the zone.
process.env.TZ = "America/Denver";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/app/actions/matters", () => ({
  setMatterSolSatisfied: vi.fn(),
}));

import {
  StatuteOfLimitationsCard,
  daysUntil,
  formatCalendarDate,
} from "./statute-of-limitations-card";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const baseProps = {
  matterId: "m1",
  satisfied: false,
  satisfiedAt: null,
  notes: null,
};

describe("daysUntil — UTC-stored deadline vs local today", () => {
  test("counts full days for a user west of UTC (evening local time)", () => {
    // 8pm MDT Jul 5 = 02:00Z Jul 6. Local today is Jul 5; the
    // deadline's UTC calendar day is Jul 10 → 5 days, not 4.
    const now = new Date("2026-07-06T02:00:00Z");
    const deadline = new Date("2026-07-10T00:00:00Z");
    expect(daysUntil(deadline, now)).toBe(5);
  });

  test("deadline day itself is 0, not -1", () => {
    // 9pm MDT on the deadline date = 03:00Z the next day. Under the
    // old local-time floor this read as 1 day overdue.
    const now = new Date("2026-07-11T03:00:00Z");
    const deadline = new Date("2026-07-10T00:00:00Z");
    expect(daysUntil(deadline, now)).toBe(0);
  });

  test("overdue counts are negative whole days", () => {
    const now = new Date("2026-07-06T18:00:00Z"); // Jul 6 local
    const deadline = new Date("2026-07-01T00:00:00Z");
    expect(daysUntil(deadline, now)).toBe(-5);
  });
});

describe("formatCalendarDate — UTC day grid", () => {
  test("renders the stored calendar day, not the local-shifted one", () => {
    // In America/Denver this instant is Jul 9, 6pm — the old
    // formatter showed "Jul 9, 2026".
    expect(formatCalendarDate(new Date("2026-07-10T00:00:00Z"))).toBe(
      "Fri, Jul 10, 2026"
    );
    // Also across a DST boundary (MST, UTC-7).
    expect(formatCalendarDate(new Date("2026-03-14T00:00:00Z"))).toBe(
      "Sat, Mar 14, 2026"
    );
  });
});

describe("StatuteOfLimitationsCard — rendered countdown", () => {
  test("shows the UTC deadline date and correct days remaining", () => {
    vi.setSystemTime(new Date("2026-07-06T02:00:00Z")); // Jul 5, 8pm MDT
    render(
      <StatuteOfLimitationsCard
        {...baseProps}
        date={new Date("2026-07-10T00:00:00Z")}
      />
    );
    expect(screen.getByText("5 days remaining")).toBeInTheDocument();
    expect(screen.getByText("Fri, Jul 10, 2026")).toBeInTheDocument();
  });

  test("shows 'Due today' through the whole local deadline day", () => {
    vi.setSystemTime(new Date("2026-07-11T03:00:00Z")); // Jul 10, 9pm MDT
    render(
      <StatuteOfLimitationsCard
        {...baseProps}
        date={new Date("2026-07-10T00:00:00Z")}
      />
    );
    expect(screen.getByText("Due today")).toBeInTheDocument();
  });

  test("shows overdue count once the local day has passed", () => {
    vi.setSystemTime(new Date("2026-07-06T18:00:00Z")); // Jul 6 local
    render(
      <StatuteOfLimitationsCard
        {...baseProps}
        date={new Date("2026-07-01T00:00:00Z")}
      />
    );
    expect(screen.getByText("5 days overdue")).toBeInTheDocument();
  });

  test("incident date renders on the UTC day grid too", () => {
    vi.setSystemTime(new Date("2026-07-06T18:00:00Z"));
    render(
      <StatuteOfLimitationsCard
        {...baseProps}
        date={new Date("2026-09-01T00:00:00Z")}
        incidentDate={new Date("2026-07-01T00:00:00Z")}
      />
    );
    expect(screen.getByText("Wed, Jul 1, 2026")).toBeInTheDocument();
  });
});
