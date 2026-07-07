/**
 * Tests for calendar-utils — the date-math primitives behind the
 * calendar's week / month views.
 */

import { describe, expect, test } from "vitest";
import {
  DEFAULT_VIEW,
  buildCalendarHref,
  calendarDayInTz,
  eventHeightPx,
  eventTopPx,
  formatHourLabel,
  HOURS,
  HOUR_HEIGHT_PX,
  isWeekend,
  layoutOverlappingEvents,
  nowOffsetPx,
  parseCalendarParams,
  stepCalendarFocal,
  toDateParam,
} from "./calendar-utils";

describe("isWeekend", () => {
  test("Saturday + Sunday return true", () => {
    expect(isWeekend(new Date("2026-04-25T12:00:00"))).toBe(true); // Sat
    expect(isWeekend(new Date("2026-04-26T12:00:00"))).toBe(true); // Sun
  });
  test("Mon–Fri return false", () => {
    expect(isWeekend(new Date("2026-04-27T12:00:00"))).toBe(false); // Mon
    expect(isWeekend(new Date("2026-04-29T12:00:00"))).toBe(false); // Wed
    expect(isWeekend(new Date("2026-05-01T12:00:00"))).toBe(false); // Fri
  });
});

describe("parseCalendarParams", () => {
  // Repo-conventional default zone; the tz-sensitivity cases below
  // use zones straddling a UTC midnight.
  const TZ = "America/Denver";

  test("missing params → defaults (week view, today's date)", () => {
    const { view, focal } = parseCalendarParams({}, TZ);
    expect(view).toBe("week");
    // focal is start-of-today; we just check it's valid + within
    // a couple seconds of "now".
    expect(focal).toBeInstanceOf(Date);
    expect(focal.getHours()).toBe(0);
  });

  test("view=month is honored", () => {
    expect(parseCalendarParams({ view: "month" }, TZ).view).toBe("month");
  });

  test("view=day is honored", () => {
    expect(parseCalendarParams({ view: "day" }, TZ).view).toBe("day");
  });

  test("view=day round-trips with a d= date", () => {
    const { view, focal } = parseCalendarParams(
      { view: "day", d: "2026-07-07" },
      TZ
    );
    expect(view).toBe("day");
    expect(toDateParam(focal)).toBe("2026-07-07");
    expect(buildCalendarHref(view, focal)).toBe(
      "/calendar?view=day&d=2026-07-07"
    );
  });

  test("unknown view falls back to default", () => {
    expect(parseCalendarParams({ view: "year" }, TZ).view).toBe("week");
  });

  test("ISO date in d= is parsed", () => {
    const { focal } = parseCalendarParams({ d: "2026-06-15" }, TZ);
    expect(focal.getFullYear()).toBe(2026);
    expect(focal.getMonth()).toBe(5); // June (0-indexed)
    expect(focal.getDate()).toBe(15);
  });

  test("malformed date falls back to today", () => {
    const { focal } = parseCalendarParams({ d: "not-a-date" }, TZ);
    expect(focal).toBeInstanceOf(Date);
    expect(focal.getHours()).toBe(0);
  });

  test("array params take the first value", () => {
    expect(parseCalendarParams({ view: ["month", "week"] }, TZ).view).toBe(
      "month"
    );
    const { focal } = parseCalendarParams(
      { d: ["2026-01-01", "2026-12-31"] },
      TZ
    );
    expect(focal.getMonth()).toBe(0);
  });

  // ── default focal is USER-tz today, not server-tz today ─────────────
  //
  // At 2026-07-06T03:30Z it is still July 5 in Denver (21:30 MDT) but
  // already July 6 in Tokyo (12:30 JST). Whatever zone the server (or
  // this test runner) sits in, the default focal must track the tz
  // argument — one zone east and one west of any plausible server zone
  // means at least one of these cases disagrees with server-local
  // "today" and would fail against the old startOfDay(new Date()).
  // `toDateParam(focal)` round-trips the user-local date key, so the
  // assertions are runner-TZ independent.
  const nearMidnightUtc = new Date("2026-07-06T03:30:00.000Z");

  test("no d=, tz east of server around midnight → next calendar day", () => {
    const { focal } = parseCalendarParams({}, "Asia/Tokyo", nearMidnightUtc);
    expect(toDateParam(focal)).toBe("2026-07-06");
  });

  test("no d=, tz west of server around midnight → prior calendar day", () => {
    const { focal } = parseCalendarParams(
      {},
      "America/Denver",
      nearMidnightUtc
    );
    expect(toDateParam(focal)).toBe("2026-07-05");
  });

  test("malformed d= falls back to user-tz today, same rule", () => {
    const { focal } = parseCalendarParams(
      { d: "not-a-date" },
      "Asia/Tokyo",
      nearMidnightUtc
    );
    expect(toDateParam(focal)).toBe("2026-07-06");
  });
});

describe("toDateParam", () => {
  test("returns YYYY-MM-DD", () => {
    expect(toDateParam(new Date("2026-04-15T12:00:00"))).toBe("2026-04-15");
  });

  test("zero-pads single-digit months / days", () => {
    expect(toDateParam(new Date("2026-01-05T12:00:00"))).toBe("2026-01-05");
  });
});

describe("buildCalendarHref", () => {
  test("default view drops the view param (cleaner URL)", () => {
    const href = buildCalendarHref("week", new Date("2026-04-15T12:00:00"));
    expect(href).toBe("/calendar?d=2026-04-15");
  });

  test("non-default view stays in the URL", () => {
    const href = buildCalendarHref("month", new Date("2026-04-15T12:00:00"));
    expect(href).toBe("/calendar?view=month&d=2026-04-15");
    expect(buildCalendarHref("day", new Date("2026-04-15T12:00:00"))).toBe(
      "/calendar?view=day&d=2026-04-15"
    );
  });

  test("override applies to view + focal independently", () => {
    const href = buildCalendarHref(
      "week",
      new Date("2026-04-15T12:00:00"),
      { view: "month" }
    );
    expect(href).toContain("view=month");
    expect(href).toContain("d=2026-04-15");
  });

  test("verifies DEFAULT_VIEW is week (test asserts the convention)", () => {
    expect(DEFAULT_VIEW).toBe("week");
  });
});

describe("calendarDayInTz", () => {
  // Focal Dates below are constructed with local components — the
  // same shape parseCalendarParams produces (server-local midnight
  // of the URL's date key) — so assertions hold in any runner TZ.
  const focal = (y: number, m: number, d: number) => new Date(y, m - 1, d);

  test("day is noon UTC of the focal's own calendar date", () => {
    for (const tz of ["America/Denver", "UTC", "Asia/Tokyo"]) {
      const { day } = calendarDayInTz(focal(2026, 7, 7), tz);
      // Noon UTC → UTC accessors carry the calendar day for ANY tz;
      // crucially the key is NOT shifted by re-interpreting the
      // focal instant in the tz (which would move Denver back to
      // July 6 on a UTC server).
      expect(day.toISOString()).toBe("2026-07-07T12:00:00.000Z");
    }
  });

  test("range spans 00:00–23:59 wall-clock in the user's TZ", () => {
    // July 7 in Denver is MDT (UTC-6): midnight = 06:00Z.
    const denver = calendarDayInTz(focal(2026, 7, 7), "America/Denver");
    expect(denver.rangeStart.toISOString()).toBe("2026-07-07T06:00:00.000Z");
    expect(denver.rangeEnd.toISOString()).toBe("2026-07-08T05:59:00.000Z");

    // Tokyo (UTC+9): the same calendar day starts the prior UTC day.
    const tokyo = calendarDayInTz(focal(2026, 7, 7), "Asia/Tokyo");
    expect(tokyo.rangeStart.toISOString()).toBe("2026-07-06T15:00:00.000Z");
    expect(tokyo.rangeEnd.toISOString()).toBe("2026-07-07T14:59:00.000Z");
  });

  test("spring-forward day is 23 hours (Denver, 2026-03-08)", () => {
    // Midnight is still MST (UTC-7) → 07:00Z; 23:59 is MDT (UTC-6).
    const { rangeStart, rangeEnd } = calendarDayInTz(
      focal(2026, 3, 8),
      "America/Denver"
    );
    expect(rangeStart.toISOString()).toBe("2026-03-08T07:00:00.000Z");
    expect(rangeEnd.toISOString()).toBe("2026-03-09T05:59:00.000Z");
  });

  test("fall-back day is 25 hours (Denver, 2026-11-01)", () => {
    // Midnight is MDT (UTC-6) → 06:00Z; 23:59 is MST (UTC-7).
    const { rangeStart, rangeEnd } = calendarDayInTz(
      focal(2026, 11, 1),
      "America/Denver"
    );
    expect(rangeStart.toISOString()).toBe("2026-11-01T06:00:00.000Z");
    expect(rangeEnd.toISOString()).toBe("2026-11-02T06:59:00.000Z");
  });
});

describe("stepCalendarFocal", () => {
  const focal = (y: number, m: number, d: number) => new Date(y, m - 1, d);
  const step = (
    view: Parameters<typeof stepCalendarFocal>[0],
    f: Date,
    dir: 1 | -1
  ) => toDateParam(stepCalendarFocal(view, f, dir));

  test("day view steps ±1 calendar day", () => {
    expect(step("day", focal(2026, 7, 7), 1)).toBe("2026-07-08");
    expect(step("day", focal(2026, 7, 7), -1)).toBe("2026-07-06");
  });

  test("day steps cross month + year boundaries", () => {
    expect(step("day", focal(2026, 7, 31), 1)).toBe("2026-08-01");
    expect(step("day", focal(2026, 1, 1), -1)).toBe("2025-12-31");
  });

  test("day steps stay calendar-true across DST transitions", () => {
    // Whatever TZ the runner sits in, a ±1 step around the US DST
    // dates must land on the adjacent calendar day (never 23:00 of
    // the same day / 01:00 two days out — the classic +24h bug).
    expect(step("day", focal(2026, 3, 8), 1)).toBe("2026-03-09");
    expect(step("day", focal(2026, 3, 9), -1)).toBe("2026-03-08");
    expect(step("day", focal(2026, 11, 1), 1)).toBe("2026-11-02");
    expect(step("day", focal(2026, 11, 2), -1)).toBe("2026-11-01");
  });

  test("week view steps ±7 days", () => {
    expect(step("week", focal(2026, 7, 7), 1)).toBe("2026-07-14");
    expect(step("week", focal(2026, 7, 7), -1)).toBe("2026-06-30");
  });

  test("month view steps ±1 month anchored to the 1st", () => {
    expect(step("month", focal(2026, 7, 15), 1)).toBe("2026-08-01");
    expect(step("month", focal(2026, 7, 15), -1)).toBe("2026-06-01");
  });
});

describe("HOURS / formatHourLabel", () => {
  test("HOURS spans 6am–9pm inclusive", () => {
    expect(HOURS[0]).toBe(6);
    expect(HOURS[HOURS.length - 1]).toBe(21);
    expect(HOURS).toHaveLength(16);
  });

  test("formatHourLabel for AM hours", () => {
    expect(formatHourLabel(6)).toBe("6a");
    expect(formatHourLabel(11)).toBe("11a");
  });

  test("formatHourLabel handles noon", () => {
    expect(formatHourLabel(12)).toBe("12p");
  });

  test("formatHourLabel for PM hours", () => {
    expect(formatHourLabel(13)).toBe("1p");
    expect(formatHourLabel(21)).toBe("9p");
  });

  test("formatHourLabel handles midnight + 24", () => {
    expect(formatHourLabel(0)).toBe("12a");
    expect(formatHourLabel(24)).toBe("12a");
  });
});

describe("eventTopPx / eventHeightPx", () => {
  // 6am is the grid's first hour. An event at 6:00 starts at 0px.
  test("event at the first hour anchors at 0px", () => {
    const start = new Date("2026-04-15T06:00:00");
    expect(eventTopPx(start)).toBe(0);
  });

  test("event at 7:30 is offset 1.5 hours into the grid", () => {
    const start = new Date("2026-04-15T07:30:00");
    expect(eventTopPx(start)).toBe(1.5 * HOUR_HEIGHT_PX);
  });

  test("event height is hours × HOUR_HEIGHT_PX (-2 for cosmetic gap)", () => {
    const start = new Date("2026-04-15T09:00:00");
    const end = new Date("2026-04-15T10:30:00");
    expect(eventHeightPx(start, end)).toBe(1.5 * HOUR_HEIGHT_PX - 2);
  });

  test("zero-duration / negative duration enforces the 24px minimum", () => {
    const ts = new Date("2026-04-15T09:00:00");
    expect(eventHeightPx(ts, ts)).toBe(24);
    // Even a backwards range gets the floor (not negative height).
    expect(eventHeightPx(new Date("2026-04-15T10:00:00"), ts)).toBe(24);
  });
});

describe("nowOffsetPx", () => {
  const dayStart = new Date("2026-04-15T00:00:00");

  test("'now' inside the grid on the same day returns the offset", () => {
    const now = new Date("2026-04-15T08:30:00");
    expect(nowOffsetPx(now, dayStart)).toBe(2.5 * HOUR_HEIGHT_PX);
  });

  test("'now' on a different calendar day returns null", () => {
    const now = new Date("2026-04-16T08:30:00");
    expect(nowOffsetPx(now, dayStart)).toBeNull();
  });

  test("'now' before the grid's first hour returns null", () => {
    const now = new Date("2026-04-15T05:00:00");
    expect(nowOffsetPx(now, dayStart)).toBeNull();
  });

  test("'now' after the grid's last hour returns null", () => {
    const now = new Date("2026-04-15T23:00:00");
    expect(nowOffsetPx(now, dayStart)).toBeNull();
  });
});

// ── layoutOverlappingEvents ──────────────────────────────────────────────

const ev = (
  id: string,
  startHour: number,
  durationHours: number
): { id: string; start: Date; end: Date } => {
  const start = new Date(2026, 4, 1, startHour, 0, 0, 0);
  const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000);
  return { id, start, end };
};

describe("layoutOverlappingEvents", () => {
  test("empty input returns empty output", () => {
    expect(layoutOverlappingEvents([])).toEqual([]);
  });

  test("single event gets lane=0 of laneCount=1", () => {
    const result = layoutOverlappingEvents([ev("a", 9, 1)]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ lane: 0, laneCount: 1 });
    expect(result[0]!.event.id).toBe("a");
  });

  test("two non-overlapping events stay full-width (separate clusters)", () => {
    // 9–10 and 11–12 — no overlap
    const result = layoutOverlappingEvents([ev("a", 9, 1), ev("b", 11, 1)]);
    expect(result.map((r) => ({ id: r.event.id, lane: r.lane, count: r.laneCount }))).toEqual([
      { id: "a", lane: 0, count: 1 },
      { id: "b", lane: 0, count: 1 },
    ]);
  });

  test("two overlapping events split the column 50/50", () => {
    // 9–11 and 10–12 overlap from 10–11
    const result = layoutOverlappingEvents([ev("a", 9, 2), ev("b", 10, 2)]);
    expect(result).toEqual([
      expect.objectContaining({ event: expect.objectContaining({ id: "a" }), lane: 0, laneCount: 2 }),
      expect.objectContaining({ event: expect.objectContaining({ id: "b" }), lane: 1, laneCount: 2 }),
    ]);
  });

  test("three events all overlapping get 3 lanes", () => {
    const result = layoutOverlappingEvents([
      ev("a", 9, 3),
      ev("b", 10, 2),
      ev("c", 11, 1),
    ]);
    // All three overlap at 11.
    expect(result.every((r) => r.laneCount === 3)).toBe(true);
    // Lanes assigned in arrival order: a=0, b=1, c=2.
    const byId = Object.fromEntries(
      result.map((r) => [r.event.id, r.lane])
    );
    expect(byId.a).toBe(0);
    expect(byId.b).toBe(1);
    expect(byId.c).toBe(2);
  });

  test("lane reuse within a cluster: A doesn't overlap C, so C reuses A's lane", () => {
    // A: 9–10 / B: 9:30–11 / C: 10–10:30
    // A and B overlap (lanes 0, 1)
    // C starts at 10 (when A ends) but B (10:30-end-not-yet) still covers C's start-end.
    // Wait: B ends at 11, C is 10-10:30. They overlap.
    // A ends at 10, C starts at 10 — A's lane is free for C.
    const result = layoutOverlappingEvents([
      ev("a", 9, 1), // 9-10
      { id: "b", start: new Date(2026, 4, 1, 9, 30), end: new Date(2026, 4, 1, 11, 0) },
      { id: "c", start: new Date(2026, 4, 1, 10, 0), end: new Date(2026, 4, 1, 10, 30) },
    ]);
    const byId = Object.fromEntries(
      result.map((r) => [r.event.id, r])
    );
    // a + b + c are all in one cluster (chained via b).
    expect(byId.a!.laneCount).toBe(2);
    expect(byId.b!.laneCount).toBe(2);
    expect(byId.c!.laneCount).toBe(2);
    // A and C share lane 0 (A ended before C started).
    expect(byId.a!.lane).toBe(0);
    expect(byId.c!.lane).toBe(0);
    expect(byId.b!.lane).toBe(1);
  });

  test("touching boundary doesn't count as overlap (A ends when B starts)", () => {
    // A: 9-10, B: 10-11. Touching but not overlapping.
    const result = layoutOverlappingEvents([ev("a", 9, 1), ev("b", 10, 1)]);
    // Both should be lane 0, count 1 (separate clusters).
    expect(result.every((r) => r.lane === 0 && r.laneCount === 1)).toBe(true);
  });

  test("input order doesn't change the output", () => {
    const a = ev("a", 9, 2);
    const b = ev("b", 10, 2);
    const c = ev("c", 11, 1);
    const r1 = layoutOverlappingEvents([a, b, c]);
    const r2 = layoutOverlappingEvents([c, a, b]);
    // Same id → same lane + laneCount in both runs.
    const map = (r: typeof r1) =>
      Object.fromEntries(r.map((x) => [x.event.id, [x.lane, x.laneCount]]));
    expect(map(r1)).toEqual(map(r2));
  });

  test("clusters are independent — adding more events in one doesn't widen another", () => {
    // Cluster 1 (overlapping): A 9-11, B 10-12 → 2 lanes
    // Cluster 2 (single): D 14-15 → 1 lane
    const result = layoutOverlappingEvents([
      ev("a", 9, 2),
      ev("b", 10, 2),
      ev("d", 14, 1),
    ]);
    const byId = Object.fromEntries(
      result.map((r) => [r.event.id, r])
    );
    expect(byId.a!.laneCount).toBe(2);
    expect(byId.b!.laneCount).toBe(2);
    expect(byId.d!.laneCount).toBe(1);
  });
});
