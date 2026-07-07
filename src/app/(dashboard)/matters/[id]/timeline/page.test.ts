/**
 * Timeline tab — day-grouping unit tests.
 *
 * Pins the TZ-correctness of `groupByDay`: rows bucket into the
 * USER's calendar days, matching the TZ-anchored timestamp shown
 * on each row. A regression to server-local bucketing
 * (`setHours(0,0,0,0)` + `toISOString()`) would pass on a dev
 * machine in the user's TZ but, on a UTC production server, file
 * a 7 PM Mountain event under the next day's header — with
 * "Today" / "Yesterday" labels disagreeing with the timestamps
 * rendered beside them.
 */

import { describe, expect, it, vi } from "vitest";

// page.tsx is a server component — its import graph pulls
// `server-only` + Prisma via the TZ getter and the matter-detail
// queries. Mock them so the pure helper is importable in the unit
// environment.
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "America/Denver"),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/queries/matter-detail", () => ({
  getMatterActivity: vi.fn(async () => []),
  getMatterActivityTypeCounts: vi.fn(async () => ({})),
}));

import { groupByDay } from "./page";

/** Minimal row shape — groupByDay is generic over the rest. */
const row = (id: string, iso: string) => ({
  id,
  timestamp: new Date(iso),
});

describe("groupByDay", () => {
  // Anchor "now" at 10:00 AM July 6 in Denver (16:00 UTC, MDT).
  const now = new Date("2026-07-06T16:00:00.000Z");
  const tz = "America/Denver";

  it("buckets by the user's calendar day, not the UTC day", () => {
    // 01:30 UTC July 6 is 7:30 PM July 5 in Denver — must group
    // under "Yesterday", not under July 6 (the UTC calendar day).
    const groups = groupByDay([row("a", "2026-07-06T01:30:00.000Z")], tz, now);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe("2026-07-05");
    expect(groups[0]!.label).toBe("Yesterday");
  });

  it("labels the user's current day 'Today' and keys it in-TZ", () => {
    // 15:00 UTC July 6 = 9:00 AM Denver — same user-day as `now`.
    const groups = groupByDay([row("a", "2026-07-06T15:00:00.000Z")], tz, now);
    expect(groups[0]!.key).toBe("2026-07-06");
    expect(groups[0]!.label).toBe("Today");
  });

  it("splits rows across a user-TZ midnight into separate groups", () => {
    // 05:00 UTC July 6 = 11:00 PM July 5 Denver;
    // 07:00 UTC July 6 = 1:00 AM July 6 Denver.
    // Same UTC day, different Denver days → two headers.
    const groups = groupByDay(
      [
        row("late", "2026-07-06T07:00:00.000Z"),
        row("early", "2026-07-06T05:00:00.000Z"),
      ],
      tz,
      now
    );
    expect(groups.map((g) => g.key)).toEqual(["2026-07-06", "2026-07-05"]);
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday"]);
  });

  it("keeps same-user-day rows in one group, preserving row order", () => {
    const groups = groupByDay(
      [
        row("b", "2026-07-06T16:30:00.000Z"),
        row("a", "2026-07-06T14:00:00.000Z"),
      ],
      tz,
      now
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("falls back to an absolute date label past the week window", () => {
    const groups = groupByDay([row("a", "2026-06-15T18:00:00.000Z")], tz, now);
    expect(groups[0]!.key).toBe("2026-06-15");
    expect(groups[0]!.label).toBe("Jun 15, 2026");
  });
});
