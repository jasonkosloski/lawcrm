/**
 * Day bucketing for the calendar views (ADR-012).
 *
 * The production server runs in UTC and users default to
 * America/Denver. Deadlines and all-day events are stored at UTC
 * midnight; bucketing them through the viewer's zone (the old
 * `dateKeyInTz(dueDate, tz)`) puts them on the PREVIOUS day. These
 * tests use exactly that data shape and a west-of-UTC zone, so they
 * fail on the old code in any host zone.
 */

import { describe, expect, test } from "vitest";
import type { CalendarDeadlineRow, CalendarEventRow } from "@/lib/queries/calendar";
import { parseDateOnly } from "@/lib/format-date";
import {
  bucketItemsByDay,
  deadlineRank,
  itemDayKeys,
  itemIsOnDay,
  weekdayShort,
} from "./bucket-items";

const TZ = "America/Denver";

const deadline = (dueKey: string, over: Partial<CalendarDeadlineRow> = {}) =>
  ({
    id: `d-${dueKey}`,
    kind: "deadline",
    title: "Answer due",
    dueDate: parseDateOnly(dueKey)!,
    deadlineKind: "manual",
    status: "open",
    matterId: "m1",
    matterName: "Smith v. Jones",
    ...over,
  }) satisfies CalendarDeadlineRow;

const event = (over: Partial<CalendarEventRow>): CalendarEventRow => ({
  id: "e1",
  kind: "event",
  title: "Hearing",
  type: "hearing",
  startTime: new Date("2026-07-07T15:00:00.000Z"),
  endTime: new Date("2026-07-07T16:00:00.000Z"),
  isAllDay: false,
  location: null,
  color: "#123456",
  matterId: "m1",
  matterName: "Smith v. Jones",
  attendeeCount: 0,
  attendeeNames: [],
  viewerCanSeeDetails: true,
  ...over,
});

describe("itemDayKeys", () => {
  test("a deadline stays on its stored calendar date for a Denver viewer", () => {
    // Stored 2026-07-06T00:00Z. dateKeyInTz(…, Denver) says 2026-07-05.
    expect(itemDayKeys(deadline("2026-07-06"), TZ)).toEqual(["2026-07-06"]);
  });

  test("a deadline due today is on today, not yesterday (evening in Denver)", () => {
    // 2026-04-28T02:00Z is Apr 27, 8 PM MDT. A deadline due Apr 27.
    expect(itemDayKeys(deadline("2026-04-27"), TZ)).toEqual(["2026-04-27"]);
  });

  test("legacy deadlines stored at a western server's local midnight keep their day", () => {
    // Rows written on a Denver laptop sit at 06:00Z — still inside the
    // right UTC day.
    const legacy = deadline("2026-07-06", {
      dueDate: new Date("2026-07-06T06:00:00.000Z"),
    });
    expect(itemDayKeys(legacy, TZ)).toEqual(["2026-07-06"]);
  });

  test("an all-day event is a date-only value: UTC date, any viewer zone", () => {
    const allDay = event({
      isAllDay: true,
      startTime: parseDateOnly("2026-07-08")!,
      endTime: parseDateOnly("2026-07-08")!,
    });
    for (const tz of [TZ, "UTC", "Asia/Tokyo", "Pacific/Auckland"]) {
      expect(itemDayKeys(allDay, tz)).toEqual(["2026-07-08"]);
    }
  });

  test("a multi-day all-day event occupies every day it covers, inclusive", () => {
    const trial = event({
      isAllDay: true,
      startTime: parseDateOnly("2026-07-06")!,
      endTime: parseDateOnly("2026-07-10")!,
    });
    expect(itemDayKeys(trial, TZ)).toEqual([
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
      "2026-07-09",
      "2026-07-10",
    ]);
  });

  test("an all-day event whose end precedes its start falls back to the start day", () => {
    const broken = event({
      isAllDay: true,
      startTime: parseDateOnly("2026-07-06")!,
      endTime: parseDateOnly("2026-07-01")!,
    });
    expect(itemDayKeys(broken, TZ)).toEqual(["2026-07-06"]);
  });

  test("a corrupt far-future end date can't expand without bound", () => {
    const corrupt = event({
      isAllDay: true,
      startTime: parseDateOnly("2026-07-06")!,
      endTime: parseDateOnly("9999-12-31")!,
    });
    expect(itemDayKeys(corrupt, TZ).length).toBeLessThanOrEqual(367);
  });

  test("a timed event buckets by the VIEWER's calendar day of its start", () => {
    // 04:30Z on Jul 8 is 10:30 PM Jul 7 in Denver, 1:30 PM Jul 8 in Tokyo.
    const late = event({
      startTime: new Date("2026-07-08T04:30:00.000Z"),
      endTime: new Date("2026-07-08T05:00:00.000Z"),
    });
    expect(itemDayKeys(late, TZ)).toEqual(["2026-07-07"]);
    expect(itemDayKeys(late, "Asia/Tokyo")).toEqual(["2026-07-08"]);
  });
});

describe("itemIsOnDay / bucketItemsByDay", () => {
  test("itemIsOnDay matches any covered day", () => {
    const trial = event({
      isAllDay: true,
      startTime: parseDateOnly("2026-07-06")!,
      endTime: parseDateOnly("2026-07-08")!,
    });
    expect(itemIsOnDay(trial, "2026-07-07", TZ)).toBe(true);
    expect(itemIsOnDay(trial, "2026-07-09", TZ)).toBe(false);
  });

  test("groups deadlines, all-day spans and timed events together", () => {
    const trial = event({
      id: "trial",
      isAllDay: true,
      startTime: parseDateOnly("2026-07-06")!,
      endTime: parseDateOnly("2026-07-07")!,
    });
    const timed = event({ id: "timed" });
    const due = deadline("2026-07-07");
    const byDay = bucketItemsByDay([trial, timed, due], TZ);
    expect(byDay.get("2026-07-06")?.map((i) => i.id)).toEqual(["trial"]);
    expect(byDay.get("2026-07-07")?.map((i) => i.id)).toEqual(["trial", "timed", due.id]);
  });
});

describe("helpers", () => {
  test("deadlineRank puts critical first", () => {
    expect(deadlineRank({ deadlineKind: "critical" })).toBeLessThan(
      deadlineRank({ deadlineKind: "manual" }),
    );
  });

  test("weekdayShort reads a noon-UTC day in UTC", () => {
    // 2026-07-05 is a Sunday; the label must not slip to Saturday
    // for a west-of-UTC runtime.
    expect(weekdayShort(new Date("2026-07-05T12:00:00.000Z"))).toBe("Sun");
  });
});
