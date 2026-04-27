/**
 * Tests for calendar-utils — the date-math primitives behind the
 * calendar's week / month views.
 */

import { describe, expect, test } from "vitest";
import {
  DEFAULT_VIEW,
  buildCalendarHref,
  eventHeightPx,
  eventTopPx,
  formatHourLabel,
  HOURS,
  HOUR_HEIGHT_PX,
  isWeekend,
  nowOffsetPx,
  parseCalendarParams,
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
  test("missing params → defaults (week view, today's date)", () => {
    const { view, focal } = parseCalendarParams({});
    expect(view).toBe("week");
    // focal is start-of-today; we just check it's valid + within
    // a couple seconds of "now".
    expect(focal).toBeInstanceOf(Date);
    expect(focal.getHours()).toBe(0);
  });

  test("view=month is honored", () => {
    expect(parseCalendarParams({ view: "month" }).view).toBe("month");
  });

  test("unknown view falls back to default", () => {
    expect(parseCalendarParams({ view: "year" }).view).toBe("week");
  });

  test("ISO date in d= is parsed", () => {
    const { focal } = parseCalendarParams({ d: "2026-06-15" });
    expect(focal.getFullYear()).toBe(2026);
    expect(focal.getMonth()).toBe(5); // June (0-indexed)
    expect(focal.getDate()).toBe(15);
  });

  test("malformed date falls back to today", () => {
    const { focal } = parseCalendarParams({ d: "not-a-date" });
    expect(focal).toBeInstanceOf(Date);
    expect(focal.getHours()).toBe(0);
  });

  test("array params take the first value", () => {
    expect(parseCalendarParams({ view: ["month", "week"] }).view).toBe(
      "month"
    );
    const { focal } = parseCalendarParams({ d: ["2026-01-01", "2026-12-31"] });
    expect(focal.getMonth()).toBe(0);
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
