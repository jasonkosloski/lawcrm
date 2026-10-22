/**
 * Agenda rail — time-label and day-grouping unit tests.
 *
 * Pins the TZ-correctness of `agendaTimeLabel`: the rail buckets
 * items into day groups in the USER's TZ, so the per-row time must
 * render in that same TZ. A regression to server-local formatting
 * (date-fns `format`) would pass on a dev machine in the user's TZ
 * but shift every time by the UTC offset in production.
 *
 * `buildAgendaGroups` pins the date-only half (ADR-012): deadlines
 * and all-day events are calendar dates stored at UTC midnight, so
 * they group by that date — not by the viewer's zone, which put
 * today's deadline under "yesterday" and dropped it from "Today".
 */

import { describe, expect, it, vi } from "vitest";
import type { CalendarDeadlineRow, CalendarEventRow } from "@/lib/queries/calendar";
import { parseDateOnly } from "@/lib/format-date";

// calendar-agenda.tsx is a server component — its import graph pulls
// Prisma via the calendar queries. Mock it so the pure helpers are
// importable in the unit environment.
vi.mock("@/lib/queries/calendar", () => ({
  getCalendarItems: vi.fn(async () => []),
}));

import { agendaRange, agendaTimeLabel, buildAgendaGroups } from "./calendar-agenda";

describe("agendaTimeLabel", () => {
  // 2026-07-06T21:30:00Z — 3:30 PM in Denver (MDT, UTC-6),
  // 5:30 PM in New York (EDT, UTC-4).
  const instant = new Date("2026-07-06T21:30:00.000Z");

  it("formats in the user's TZ, not the server's", () => {
    expect(agendaTimeLabel(instant, false, "America/Denver")).toBe("3:30pm");
    // Same instant, different user TZ → different label. Pins that
    // the TZ arg is actually threaded through to Intl.
    expect(agendaTimeLabel(instant, false, "America/New_York")).toBe("5:30pm");
  });

  it("stays on the user's calendar day across UTC midnight", () => {
    // 02:00 UTC July 7 is still 8:00 PM July 6 in Denver — the day
    // grouping puts this under the July 6 heading, so the label must
    // agree (the old server-TZ format would have said "2:00am" on a
    // UTC production server).
    const lateEvening = new Date("2026-07-07T02:00:00.000Z");
    expect(agendaTimeLabel(lateEvening, false, "America/Denver")).toBe("8:00pm");
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

const TZ = "America/Denver";

const deadline = (
  dueKey: string,
  over: Partial<CalendarDeadlineRow> = {},
): CalendarDeadlineRow => ({
  id: `d-${dueKey}-${over.deadlineKind ?? "manual"}`,
  kind: "deadline",
  title: "Answer due",
  dueDate: parseDateOnly(dueKey)!,
  deadlineKind: "manual",
  status: "open",
  matterId: "m1",
  matterName: "Smith v. Jones",
  ...over,
});

const event = (over: Partial<CalendarEventRow>): CalendarEventRow => ({
  id: "e1",
  kind: "event",
  title: "Hearing",
  type: "hearing",
  startTime: new Date("2026-04-28T15:00:00.000Z"),
  endTime: new Date("2026-04-28T16:00:00.000Z"),
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

describe("buildAgendaGroups", () => {
  // 2026-04-28T02:00Z is Apr 27, 8 PM in Denver — "today" is Apr 27.
  const TODAY = "2026-04-27";

  it("puts a deadline due today under today (not under yesterday)", () => {
    const groups = buildAgendaGroups([deadline("2026-04-27")], TZ, TODAY);
    expect(groups.map((g) => g.dayKey)).toEqual(["2026-04-27"]);
  });

  it("puts tomorrow's deadline under tomorrow, not under today", () => {
    const groups = buildAgendaGroups([deadline("2026-04-28")], TZ, TODAY);
    expect(groups.map((g) => g.dayKey)).toEqual(["2026-04-28"]);
  });

  it("groups a timed event by the viewer's day, a deadline by its date", () => {
    // 03:30Z Apr 28 is 9:30 PM Apr 27 in Denver.
    const lateEvent = event({
      startTime: new Date("2026-04-28T03:30:00.000Z"),
      endTime: new Date("2026-04-28T04:30:00.000Z"),
    });
    const groups = buildAgendaGroups([lateEvent, deadline("2026-04-27")], TZ, TODAY);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.dayKey).toBe("2026-04-27");
    // Deadline first, then the event.
    expect(groups[0]!.items.map((i) => i.kind)).toEqual(["deadline", "event"]);
  });

  it("orders a day: critical deadlines, other deadlines, all-day, then timed by start", () => {
    const allDay = event({
      id: "allday",
      isAllDay: true,
      startTime: parseDateOnly("2026-04-27")!,
      endTime: parseDateOnly("2026-04-27")!,
    });
    const early = event({
      id: "early",
      startTime: new Date("2026-04-27T15:00:00.000Z"),
    });
    const late = event({
      id: "late",
      startTime: new Date("2026-04-27T20:00:00.000Z"),
    });
    const manual = deadline("2026-04-27", { deadlineKind: "manual" });
    const critical = deadline("2026-04-27", { deadlineKind: "critical" });
    const groups = buildAgendaGroups([late, manual, early, allDay, critical], TZ, TODAY);
    expect(groups[0]!.items.map((i) => i.id)).toEqual([
      critical.id,
      manual.id,
      "allday",
      "early",
      "late",
    ]);
  });

  it("shows a multi-day all-day event under every day it covers, clipped to the window", () => {
    const trial = event({
      id: "trial",
      isAllDay: true,
      // Started two days before today and runs through Apr 28.
      startTime: parseDateOnly("2026-04-25")!,
      endTime: parseDateOnly("2026-04-28")!,
    });
    const groups = buildAgendaGroups([trial], TZ, TODAY);
    expect(groups.map((g) => g.dayKey)).toEqual(["2026-04-27", "2026-04-28"]);
  });

  it("drops items outside the 14-day window and sorts groups chronologically", () => {
    const groups = buildAgendaGroups(
      [
        deadline("2026-05-05"),
        deadline("2026-04-27"),
        deadline("2026-06-30"),
        deadline("2026-04-20"),
      ],
      TZ,
      TODAY,
    );
    expect(groups.map((g) => g.dayKey)).toEqual(["2026-04-27", "2026-05-05"]);
  });
});

describe("agendaRange", () => {
  it("runs from the start of the viewer's today to the end of day today+14", () => {
    const { start, end } = agendaRange("2026-04-27", TZ);
    // Apr 27 00:00 MDT = 06:00Z; May 11 23:59 MDT = May 12 05:59Z.
    expect(start.toISOString()).toBe("2026-04-27T06:00:00.000Z");
    expect(end.toISOString()).toBe("2026-05-12T05:59:00.000Z");
  });
});
