/**
 * Drag / resize / position math for the hour grid. All of it takes
 * the user's profile zone explicitly; the assertions use fixed
 * instants so they hold in the Denver and TZ=UTC suite runs alike.
 */

import { describe, expect, test } from "vitest";
import { HOUR_HEIGHT_PX } from "@/lib/calendar-utils";
import type { CalendarEventDragData } from "./event-drag";
import {
  chipBox,
  clampEndToGrid,
  clampStartToGrid,
  computeTimedDrop,
  formatTimeShort,
  GRID_HEIGHT_PX,
  instantAtGridMinutes,
  minutesOnDay,
  nowTopPx,
  snapMinutes,
} from "./grid-time";

const TZ = "America/Denver";
const DAY = "2026-07-07";
const iso = (s: string) => new Date(s).toISOString();

const drag = (over: Partial<CalendarEventDragData>): CalendarEventDragData => ({
  id: "e1",
  isAllDay: false,
  startTimeIso: iso("2026-07-07T15:00:00Z"), // 9:00 MDT
  endTimeIso: iso("2026-07-07T16:30:00Z"), // 10:30 MDT
  grabOffsetY: 0,
  ...over,
});

describe("time of day in the user's zone", () => {
  test("minutesOnDay / formatTimeShort read the zone, not the runner", () => {
    const d = new Date("2026-07-07T15:05:00Z"); // 9:05 MDT
    expect(minutesOnDay(d, DAY, TZ)).toBe(9 * 60 + 5);
    expect(formatTimeShort(d, TZ)).toBe("9:05am");
    expect(formatTimeShort(new Date("2026-07-07T00:00:00Z"), TZ)).toBe(
      "6:00pm"
    );
    expect(formatTimeShort(new Date("2026-07-07T06:30:00Z"), TZ)).toBe(
      "12:30am"
    );
  });

  test("minutesOnDay counts whole days before / after the column", () => {
    expect(
      minutesOnDay(new Date("2026-07-06T15:00:00Z"), DAY, TZ)
    ).toBe(9 * 60 - 1440);
    expect(
      minutesOnDay(new Date("2026-07-08T15:00:00Z"), DAY, TZ)
    ).toBe(9 * 60 + 1440);
  });
});

describe("chipBox", () => {
  test("an in-grid chip sits at (h-6)*48 with a duration-based height", () => {
    const b = chipBox(
      new Date("2026-07-07T15:00:00Z"), // 9:00 MDT
      new Date("2026-07-07T16:30:00Z"),
      DAY,
      TZ
    );
    expect(b.top).toBe(3 * HOUR_HEIGHT_PX);
    expect(b.height).toBe(1.5 * HOUR_HEIGHT_PX - 2);
    expect(b.clippedTop).toBe(false);
    expect(b.clippedBottom).toBe(false);
  });

  test("a chip positions by the user's zone: 9am MDT is the 9am row even when UTC says 3pm", () => {
    const b = chipBox(
      new Date("2026-07-07T15:00:00Z"),
      new Date("2026-07-07T16:00:00Z"),
      DAY,
      TZ
    );
    expect(b.top).toBe(144); // (9 - 6) * 48, not (15 - 6) * 48
  });

  test("a pre-6am event is clamped into the grid and marked clipped", () => {
    const b = chipBox(
      new Date("2026-07-07T11:30:00Z"), // 5:30 MDT
      new Date("2026-07-07T13:00:00Z"), // 7:00 MDT
      DAY,
      TZ
    );
    expect(b.top).toBe(0);
    expect(b.clippedTop).toBe(true);
    expect(b.clippedBottom).toBe(false);
    expect(b.height).toBe(1 * HOUR_HEIGHT_PX - 2);
  });

  test("a post-10pm event stays inside the grid", () => {
    const b = chipBox(
      new Date("2026-07-08T04:30:00Z"), // 22:30 MDT Jul 7
      new Date("2026-07-08T05:30:00Z"),
      DAY,
      TZ
    );
    expect(b.top + b.height).toBeLessThanOrEqual(GRID_HEIGHT_PX);
    expect(b.clippedBottom).toBe(true);
  });

  test("a multi-day timed block is cut at the bottom of its start day", () => {
    const b = chipBox(
      new Date("2026-07-07T15:00:00Z"), // Tue 9am
      new Date("2026-07-08T23:00:00Z"), // Wed 5pm
      DAY,
      TZ
    );
    expect(b.top).toBe(3 * HOUR_HEIGHT_PX);
    expect(b.top + b.height).toBeLessThanOrEqual(GRID_HEIGHT_PX);
    expect(b.clippedBottom).toBe(true);
  });
});

describe("nowTopPx", () => {
  test("lands on the viewer's today at the viewer's hour", () => {
    // 2026-07-08T03:30Z = Jul 7 21:30 MDT.
    const now = new Date("2026-07-08T03:30:00Z");
    expect(nowTopPx(now, "2026-07-07", TZ)).toBe(15.5 * HOUR_HEIGHT_PX);
    expect(nowTopPx(now, "2026-07-08", TZ)).toBeNull();
  });

  test("null outside the visible hours", () => {
    expect(
      nowTopPx(new Date("2026-07-07T10:00:00Z"), "2026-07-07", TZ) // 4am
    ).toBeNull();
  });
});

describe("snap + timed drop", () => {
  test("snaps the chip's TOP (cursor minus grab offset) to 15 minutes", () => {
    // Cursor ~3h12m into the grid, grabbed 30px below the chip top.
    const y = 3 * HOUR_HEIGHT_PX + 10;
    expect(snapMinutes(y, { isAllDay: false, grabOffsetY: 0 })).toBe(195);
    expect(snapMinutes(y + 30, { isAllDay: false, grabOffsetY: 30 })).toBe(195);
    // All-day chips ignore the grab offset.
    expect(snapMinutes(y, { isAllDay: true, grabOffsetY: 30 })).toBe(195);
  });

  test("clamps to the grid", () => {
    expect(snapMinutes(-100, { isAllDay: false, grabOffsetY: 0 })).toBe(0);
    expect(snapMinutes(99999, { isAllDay: false, grabOffsetY: 0 })).toBe(945);
  });

  test("instantAtGridMinutes builds the zone's wall clock, not the runner's", () => {
    expect(instantAtGridMinutes(DAY, 0, TZ).toISOString()).toBe(
      "2026-07-07T12:00:00.000Z" // 6:00 MDT
    );
    expect(instantAtGridMinutes(DAY, 195, TZ).toISOString()).toBe(
      "2026-07-07T15:15:00.000Z" // 9:15 MDT
    );
  });

  test("a timed chip moved to a new slot keeps its duration", () => {
    const s = computeTimedDrop(
      drag({}),
      5 * HOUR_HEIGHT_PX, // 11:00
      DAY,
      TZ
    )!;
    expect(s.isAllDay).toBe(false);
    expect(s.start.toISOString()).toBe("2026-07-07T17:00:00.000Z");
    expect(s.end.toISOString()).toBe("2026-07-07T18:30:00.000Z");
  });

  test("a timed chip dropped to another day lands on that day's wall clock", () => {
    const s = computeTimedDrop(drag({}), 3 * HOUR_HEIGHT_PX, "2026-07-09", TZ)!;
    expect(s.start.toISOString()).toBe("2026-07-09T15:00:00.000Z");
  });

  test("an all-day chip dropped on the grid becomes a 2-hour timed event", () => {
    const s = computeTimedDrop(
      drag({
        isAllDay: true,
        startTimeIso: iso("2026-07-07T00:00:00Z"),
        endTimeIso: iso("2026-07-07T00:00:00Z"),
      }),
      4 * HOUR_HEIGHT_PX,
      DAY,
      TZ
    )!;
    expect(s.start.toISOString()).toBe("2026-07-07T16:00:00.000Z"); // 10:00
    expect(s.end.toISOString()).toBe("2026-07-07T18:00:00.000Z");
  });

  test("dropping a chip back on its own slot is a no-op", () => {
    expect(
      computeTimedDrop(drag({}), 3 * HOUR_HEIGHT_PX, DAY, TZ)
    ).toBeNull();
  });

  test("an off-grid 9:07 start dropped on its own 9:00 slot is not rewritten", () => {
    const d = drag({
      startTimeIso: iso("2026-07-07T15:07:00Z"),
      endTimeIso: iso("2026-07-07T15:37:00Z"),
    });
    expect(computeTimedDrop(d, 3 * HOUR_HEIGHT_PX, DAY, TZ)).toBeNull();
    // Moving it a real slot still writes.
    expect(
      computeTimedDrop(d, 3.25 * HOUR_HEIGHT_PX, DAY, TZ)
    ).not.toBeNull();
  });

  test("the same slot on a DIFFERENT day is a real move", () => {
    expect(
      computeTimedDrop(drag({}), 3 * HOUR_HEIGHT_PX, "2026-07-08", TZ)
    ).not.toBeNull();
  });
});

describe("resize clamps", () => {
  test("a top-edge drag stops at the grid's first hour of the event's day", () => {
    const original = new Date("2026-07-07T15:00:00Z"); // 9:00 MDT
    const proposed = new Date("2026-07-07T09:00:00Z"); // 3:00 MDT
    expect(clampStartToGrid(proposed, original, TZ).toISOString()).toBe(
      "2026-07-07T12:00:00.000Z" // 6:00 MDT
    );
    expect(
      clampStartToGrid(new Date("2026-07-07T14:00:00Z"), original, TZ).toISOString()
    ).toBe("2026-07-07T14:00:00.000Z");
  });

  test("a bottom-edge drag stops at 10pm of the event's end day", () => {
    const original = new Date("2026-07-07T16:00:00Z");
    expect(
      clampEndToGrid(new Date("2026-07-08T09:00:00Z"), original, TZ).toISOString()
    ).toBe("2026-07-08T04:00:00.000Z"); // 22:00 MDT Jul 7
  });

  test("an event already outside the grid is not pulled to the edge", () => {
    // Starts 5:30 MDT; nudging its top handle must not jump it to 6:00.
    const original = new Date("2026-07-07T11:30:00Z");
    expect(
      clampStartToGrid(new Date("2026-07-07T11:30:00Z"), original, TZ).toISOString()
    ).toBe("2026-07-07T11:30:00.000Z");
    // Starts after 10pm: bottom handle may not be clamped upward.
    const late = new Date("2026-07-08T05:30:00Z"); // 23:30 MDT
    expect(
      clampEndToGrid(new Date("2026-07-08T05:30:00Z"), late, TZ).toISOString()
    ).toBe("2026-07-08T05:30:00.000Z");
  });
});
