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

import { afterEach, describe, expect, it, vi } from "vitest";

// page.tsx is a server component — its import graph pulls
// `server-only` + Prisma via the TZ getter and the matter-detail
// queries. Mock them so the pure helper is importable in the unit
// environment.
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "America/Denver"),
}));
vi.mock("@/lib/queries/matters", () => ({
  getMatterById: vi.fn(async () => ({ id: "m1" })),
}));
vi.mock("@/lib/queries/matter-detail", () => ({
  MATTER_ACTIVITY_LIMIT: 200,
  getMatterActivity: vi.fn(async () => []),
  getMatterActivityTypeCounts: vi.fn(async () => ({})),
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/lib/current-user", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  currentUserHasPermission: vi.fn(),
}));

import { requireUser } from "@/lib/current-user";
import { currentUserHasPermission } from "@/lib/permission-check";
import {
  getMatterActivity,
  getMatterActivityTypeCounts,
} from "@/lib/queries/matter-detail";
import { getMatterById } from "@/lib/queries/matters";
import MatterTimelinePage, { groupByDay } from "./page";

const renderTimeline = (sp: Record<string, string | string[]> = {}) =>
  MatterTimelinePage({
    params: Promise.resolve({ id: "m1" }),
    searchParams: Promise.resolve(sp),
  } as Parameters<typeof MatterTimelinePage>[0]);

describe("MatterTimelinePage — session + money gating", () => {
  afterEach(() => {
    vi.mocked(requireUser).mockReset();
    vi.mocked(currentUserHasPermission).mockReset();
    vi.mocked(getMatterActivity).mockClear();
    vi.mocked(getMatterActivityTypeCounts).mockClear();
  });

  it("bounces a missing session before any data is read", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(renderTimeline()).rejects.toThrow("NEXT_REDIRECT");
    expect(getMatterActivity).not.toHaveBeenCalled();
    expect(getMatterActivityTypeCounts).not.toHaveBeenCalled();
  });

  it("viewer lacking settlement/expense view keys gets both queries restricted", async () => {
    vi.mocked(requireUser).mockResolvedValue("u1");
    vi.mocked(currentUserHasPermission).mockResolvedValue(false);
    await renderTimeline();
    expect(getMatterActivity).toHaveBeenCalledWith(
      "m1",
      expect.objectContaining({
        canViewSettlement: false,
        canViewExpense: false,
        canViewBilling: false,
      })
    );
    expect(getMatterActivityTypeCounts).toHaveBeenCalledWith("m1", {
      canViewSettlement: false,
      canViewExpense: false,
      canViewBilling: false,
    });
  });

  it("each key is resolved independently", async () => {
    vi.mocked(requireUser).mockResolvedValue("u1");
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (key: string) => key === "matters.expense.view"
    );
    await renderTimeline();
    expect(getMatterActivityTypeCounts).toHaveBeenCalledWith("m1", {
      canViewSettlement: false,
      canViewExpense: true,
      canViewBilling: false,
    });
  });

  it("billing.view (trust deposit rows) is resolved on its own", async () => {
    vi.mocked(requireUser).mockResolvedValue("u1");
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (key: string) => key === "billing.view"
    );
    await renderTimeline();
    expect(getMatterActivityTypeCounts).toHaveBeenCalledWith("m1", {
      canViewSettlement: false,
      canViewExpense: false,
      canViewBilling: true,
    });
  });
});

describe("MatterTimelinePage — ?type= filter", () => {
  afterEach(() => {
    vi.mocked(requireUser).mockReset();
    vi.mocked(currentUserHasPermission).mockReset();
    vi.mocked(getMatterActivity).mockClear();
    vi.mocked(getMatterById).mockClear();
  });

  const typesPassed = (): readonly string[] | undefined =>
    (vi.mocked(getMatterActivity).mock.calls[0][1] as { types?: string[] })
      .types;

  it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
    "prototype key ?type=%s falls back to All instead of crashing",
    async (key) => {
      vi.mocked(requireUser).mockResolvedValue("u1");
      vi.mocked(currentUserHasPermission).mockResolvedValue(true);
      await renderTimeline({ type: key });
      expect(typesPassed()).toBeUndefined();
    }
  );

  it("an unknown ?type= falls back to All", async () => {
    vi.mocked(requireUser).mockResolvedValue("u1");
    vi.mocked(currentUserHasPermission).mockResolvedValue(true);
    await renderTimeline({ type: "nope" });
    expect(typesPassed()).toBeUndefined();
  });

  it("known buckets filter, including the Documents and Evidence pills", async () => {
    vi.mocked(requireUser).mockResolvedValue("u1");
    vi.mocked(currentUserHasPermission).mockResolvedValue(true);
    await renderTimeline({ type: "documents" });
    expect(typesPassed()).toEqual(["document"]);
    vi.mocked(getMatterActivity).mockClear();
    await renderTimeline({ type: "evidence" });
    expect(typesPassed()).toEqual(["evidence"]);
    vi.mocked(getMatterActivity).mockClear();
    // The URL key stays `filings` so old shared links keep working.
    await renderTimeline({ type: "filings" });
    expect(typesPassed()).toEqual(["filing"]);
  });

  it("404s a missing matter", async () => {
    vi.mocked(requireUser).mockResolvedValue("u1");
    vi.mocked(currentUserHasPermission).mockResolvedValue(true);
    vi.mocked(getMatterById).mockResolvedValueOnce(null as never);
    await expect(renderTimeline()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

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
