/**
 * Integration tests for calendar query visibility stripping.
 *
 * The pure resolver (canViewEventDetails) is tested in
 * src/lib/calendar-visibility.test.ts. Here we verify the
 * server-side strip in the queries themselves: when the resolver
 * says "no", does getCalendarItems / getCalendarEventById actually
 * scrub the sensitive fields before returning to the client?
 *
 * Privacy is a server-side guarantee — the chip is supposed to
 * render whatever the query gives it. So if the query leaks
 * fields here, every chip / modal in the app leaks them.
 *
 * Each scenario below seeds a single event with a different
 * unlock condition (or no unlock), then asserts whether the
 * sensitive fields survive or come back scrubbed. The five
 * resolver branches are covered: creator, attendee, matter team,
 * per-event override, creator user-default.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
// The calendar queries match date-only rows by the viewer's day keys;
// current-user-tz is server-only, so stub the viewer's profile zone.
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "America/Denver"),
}));

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { dateOnlyKey, instantInTz } from "@/lib/format-date";
import {
  getCalendarEventById,
  getCalendarItems,
} from "@/lib/queries/calendar";
import {
  getMatterDeadlines,
  getMatterEvents,
  getMatterNotes,
  getMatterTasks,
} from "@/lib/queries/matter-detail";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);

let firmId: string;
let creatorId: string;
let viewerId: string;
let outsideUserId: string;
let matterId: string;
let nonMatterEventId: string;
let matterEventId: string;

const RANGE_START = new Date("2026-06-01T00:00:00Z");
const RANGE_END = new Date("2026-06-30T23:59:59Z");

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
});

beforeEach(async () => {
  await resetDb();
  const f = await seedFirm();
  firmId = f.firmId;
  // Three actors:
  //   creator — owns the events; bypasses the resolver
  //   viewer  — the stranger asking the question; default-deny
  //             unless we wire up an unlock
  //   outside — never on any team / attendee list; sanity check
  const creator = await seedUser({ firmId, name: "Creator", email: "c@firm.com" });
  creatorId = creator.userId;
  const viewer = await seedUser({ firmId, name: "Viewer", email: "v@firm.com" });
  viewerId = viewer.userId;
  const outside = await seedUser({ firmId, name: "Outside", email: "o@firm.com" });
  outsideUserId = outside.userId;
  // Default to viewing AS the viewer (so the resolver runs the
  // gate). Individual tests can re-point this to creator/outside.
  mockedGetUser.mockResolvedValue(viewerId);

  const a = await seedPracticeArea();
  const m = await seedMatter({
    practiceAreaId: a.areaId,
    stageId: a.stageId,
    leadUserId: creatorId,
  });
  matterId = m.matterId;

  // A non-matter ("personal") event the creator owns — no team,
  // no attendees, no overrides. The default-deny case.
  const personal = await prisma.calendarEvent.create({
    data: {
      title: "Therapy",
      type: "personal",
      startTime: new Date("2026-06-10T15:00:00Z"),
      endTime: new Date("2026-06-10T16:00:00Z"),
      location: "123 Couch St",
      description: "Confidential",
      zoomUrl: "https://zoom.example/abc",
      createdById: creatorId,
      visibility: "default",
    },
    select: { id: true },
  });
  nonMatterEventId = personal.id;

  // A matter event with the creator as the matter lead. The
  // matter team list will be just the creator unless a test adds
  // more.
  const matterEvt = await prisma.calendarEvent.create({
    data: {
      matterId,
      title: "Strategy session",
      type: "meeting",
      startTime: new Date("2026-06-15T13:00:00Z"),
      endTime: new Date("2026-06-15T14:00:00Z"),
      location: "Conference room",
      description: "Discuss settlement",
      zoomUrl: null,
      createdById: creatorId,
      visibility: "default",
    },
    select: { id: true },
  });
  matterEventId = matterEvt.id;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getCalendarItems — visibility stripping", () => {
  test("stranger sees a 'Busy' block, not the personal event details", async () => {
    const items = await getCalendarItems(RANGE_START, RANGE_END);
    const personal = items.find(
      (i) => i.kind === "event" && i.id === nonMatterEventId
    );
    expect(personal?.kind).toBe("event");
    if (personal?.kind !== "event") return; // narrow

    expect(personal.viewerCanSeeDetails).toBe(false);
    expect(personal.title).toBe("Busy");
    // Time + isAllDay must survive — that's the whole point of
    // the busy block.
    expect(personal.startTime).toEqual(new Date("2026-06-10T15:00:00Z"));
    expect(personal.endTime).toEqual(new Date("2026-06-10T16:00:00Z"));
    // Detail fields are scrubbed.
    expect(personal.location).toBeNull();
    expect(personal.matterId).toBeNull();
    expect(personal.matterName).toBeNull();
    expect(personal.attendeeCount).toBe(0);
    expect(personal.attendeeNames).toEqual([]);
    // Color falls back to a neutral so all "Busy" blocks read
    // uniformly regardless of which matter they came from.
    expect(personal.color).toBe("var(--color-ink-3)");
  });

  test("creator sees full details on their own personal event", async () => {
    mockedGetUser.mockResolvedValue(creatorId);
    const items = await getCalendarItems(RANGE_START, RANGE_END);
    const personal = items.find(
      (i) => i.kind === "event" && i.id === nonMatterEventId
    );
    if (personal?.kind !== "event") throw new Error("event missing");
    expect(personal.viewerCanSeeDetails).toBe(true);
    expect(personal.title).toBe("Therapy");
    expect(personal.location).toBe("123 Couch St");
  });

  test("attendee sees full details", async () => {
    await prisma.calendarAttendee.create({
      data: {
        eventId: nonMatterEventId,
        userId: viewerId,
        name: "Viewer",
        status: "accepted",
      },
    });
    const items = await getCalendarItems(RANGE_START, RANGE_END);
    const personal = items.find(
      (i) => i.kind === "event" && i.id === nonMatterEventId
    );
    if (personal?.kind !== "event") throw new Error("event missing");
    expect(personal.viewerCanSeeDetails).toBe(true);
    expect(personal.title).toBe("Therapy");
    expect(personal.attendeeCount).toBe(1);
  });

  test("matter team member sees full details on a matter event", async () => {
    await prisma.matterTeamMember.create({
      data: { matterId, userId: viewerId, role: "co_counsel" },
    });
    const items = await getCalendarItems(RANGE_START, RANGE_END);
    const evt = items.find(
      (i) => i.kind === "event" && i.id === matterEventId
    );
    if (evt?.kind !== "event") throw new Error("event missing");
    expect(evt.viewerCanSeeDetails).toBe(true);
    expect(evt.title).toBe("Strategy session");
    expect(evt.matterId).toBe(matterId);
  });

  test("non-matter-team viewer sees the matter event as 'Busy'", async () => {
    // Viewer is firm-mate but NOT on the matter team. Default-deny
    // applies — even matter events stay private to the case team.
    const items = await getCalendarItems(RANGE_START, RANGE_END);
    const evt = items.find(
      (i) => i.kind === "event" && i.id === matterEventId
    );
    if (evt?.kind !== "event") throw new Error("event missing");
    expect(evt.viewerCanSeeDetails).toBe(false);
    expect(evt.title).toBe("Busy");
    expect(evt.matterId).toBeNull();
    expect(evt.matterName).toBeNull();
    expect(evt.location).toBeNull();
  });

  test("per-event 'show_details' override unlocks for everyone", async () => {
    await prisma.calendarEvent.update({
      where: { id: nonMatterEventId },
      data: { visibility: "show_details" },
    });
    const items = await getCalendarItems(RANGE_START, RANGE_END);
    const personal = items.find(
      (i) => i.kind === "event" && i.id === nonMatterEventId
    );
    if (personal?.kind !== "event") throw new Error("event missing");
    expect(personal.viewerCanSeeDetails).toBe(true);
    expect(personal.title).toBe("Therapy");
  });

  test("creator's user-default 'show_details' unlocks default-visibility events", async () => {
    await prisma.user.update({
      where: { id: creatorId },
      data: { defaultEventVisibility: "show_details" },
    });
    const items = await getCalendarItems(RANGE_START, RANGE_END);
    const personal = items.find(
      (i) => i.kind === "event" && i.id === nonMatterEventId
    );
    if (personal?.kind !== "event") throw new Error("event missing");
    expect(personal.viewerCanSeeDetails).toBe(true);
    expect(personal.title).toBe("Therapy");
  });

  test("third-party (no relationship at all) is denied — sanity check", async () => {
    mockedGetUser.mockResolvedValue(outsideUserId);
    const items = await getCalendarItems(RANGE_START, RANGE_END);
    const personal = items.find(
      (i) => i.kind === "event" && i.id === nonMatterEventId
    );
    if (personal?.kind !== "event") throw new Error("event missing");
    expect(personal.viewerCanSeeDetails).toBe(false);
    expect(personal.title).toBe("Busy");
  });
});

describe("getCalendarEventById — visibility stripping", () => {
  test("stranger gets a stripped detail shape, not the rich event", async () => {
    const e = await getCalendarEventById(nonMatterEventId);
    expect(e).not.toBeNull();
    expect(e!.viewerCanSeeDetails).toBe(false);
    expect(e!.title).toBe("Busy");
    // Modal-only fields scrubbed too.
    expect(e!.description).toBeNull();
    expect(e!.location).toBeNull();
    expect(e!.zoomUrl).toBeNull();
    expect(e!.matter).toBeNull();
    expect(e!.attendees).toEqual([]);
    // Time still flows through so the modal can render the
    // "Unavailable from X to Y" line.
    expect(e!.startTime).toEqual(new Date("2026-06-10T15:00:00Z"));
    expect(e!.endTime).toEqual(new Date("2026-06-10T16:00:00Z"));
    // Per-event visibility flag is preserved — the modal needs it
    // for the "Show details to others" toggle UI when the viewer
    // is the creator.
    expect(e!.visibility).toBe("default");
  });

  test("creator sees full detail on their own event", async () => {
    mockedGetUser.mockResolvedValue(creatorId);
    const e = await getCalendarEventById(nonMatterEventId);
    expect(e!.viewerCanSeeDetails).toBe(true);
    expect(e!.title).toBe("Therapy");
    expect(e!.description).toBe("Confidential");
    expect(e!.zoomUrl).toBe("https://zoom.example/abc");
  });

  test("attendee gets full detail", async () => {
    await prisma.calendarAttendee.create({
      data: {
        eventId: nonMatterEventId,
        userId: viewerId,
        name: "Viewer",
        status: "accepted",
      },
    });
    const e = await getCalendarEventById(nonMatterEventId);
    expect(e!.viewerCanSeeDetails).toBe(true);
    expect(e!.title).toBe("Therapy");
    expect(e!.attendees).toHaveLength(1);
  });

  test("matter team member sees full detail on a matter event", async () => {
    await prisma.matterTeamMember.create({
      data: { matterId, userId: viewerId, role: "co_counsel" },
    });
    const e = await getCalendarEventById(matterEventId);
    expect(e!.viewerCanSeeDetails).toBe(true);
    expect(e!.title).toBe("Strategy session");
    expect(e!.matter?.id).toBe(matterId);
  });

  test("non-team viewer on a matter event also gets 'Busy' (matter membership is the only unlock)", async () => {
    const e = await getCalendarEventById(matterEventId);
    expect(e!.viewerCanSeeDetails).toBe(false);
    expect(e!.title).toBe("Busy");
    expect(e!.matter).toBeNull();
    expect(e!.location).toBeNull();
  });

  test("per-event 'show_details' override unlocks the modal", async () => {
    await prisma.calendarEvent.update({
      where: { id: nonMatterEventId },
      data: { visibility: "show_details" },
    });
    const e = await getCalendarEventById(nonMatterEventId);
    expect(e!.viewerCanSeeDetails).toBe(true);
    expect(e!.title).toBe("Therapy");
    expect(e!.visibility).toBe("show_details");
  });

  test("creator user-default 'show_details' unlocks the modal", async () => {
    await prisma.user.update({
      where: { id: creatorId },
      data: { defaultEventVisibility: "show_details" },
    });
    const e = await getCalendarEventById(nonMatterEventId);
    expect(e!.viewerCanSeeDetails).toBe(true);
    expect(e!.title).toBe("Therapy");
  });

  test("returns null for a missing event id", async () => {
    const e = await getCalendarEventById("does-not-exist");
    expect(e).toBeNull();
  });
});

describe("getMatterEvents — matter Events tab visibility stripping", () => {
  beforeEach(async () => {
    // Attach a note and a privileged time entry to the matter event so
    // a leak would be visible in the result.
    await prisma.note.create({
      data: {
        matterId,
        authorId: creatorId,
        content: "Secret strategy note",
        calendarEventId: matterEventId,
      },
    });
    await prisma.timeEntry.create({
      data: {
        matterId,
        userId: creatorId,
        calendarEventId: matterEventId,
        date: new Date("2026-06-15"),
        hours: 1,
        activity: "Prep",
        narrative: "Privileged narrative",
        privileged: true,
      },
    });
    await prisma.calendarEvent.update({
      where: { id: matterEventId },
      data: { zoomUrl: "https://zoom.example/secret" },
    });
  });

  test("non-team, non-attendee viewer gets a Busy shell with nothing but times", async () => {
    const rows = await getMatterEvents(matterId);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    // Identity + times survive (ids feed the ?event= guard; times feed
    // the upcoming/past split).
    expect(r.id).toBe(matterEventId);
    expect(r.startTime).toEqual(new Date("2026-06-15T13:00:00Z"));
    expect(r.endTime).toEqual(new Date("2026-06-15T14:00:00Z"));
    expect(r.viewerCanSeeDetails).toBe(false);
    expect(r.title).toBe("Busy");
    expect(r.type).toBe("block_time");
    expect(r.location).toBeNull();
    expect(r.zoomUrl).toBeNull();
    expect(r.attendeeCount).toBe(0);
    expect(r.notes).toEqual([]);
    expect(r.timeEntries).toEqual([]);
    expect(JSON.stringify(r)).not.toMatch(
      /Strategy session|Conference room|Secret strategy|Privileged narrative|zoom\.example/
    );
  });

  test("matter team member sees the full row", async () => {
    await prisma.matterTeamMember.create({
      data: { matterId, userId: viewerId, role: "co_counsel" },
    });
    const [r] = await getMatterEvents(matterId);
    expect(r.viewerCanSeeDetails).toBe(true);
    expect(r.title).toBe("Strategy session");
    expect(r.location).toBe("Conference room");
    expect(r.zoomUrl).toBe("https://zoom.example/secret");
    expect(r.notes.map((n) => n.content)).toEqual(["Secret strategy note"]);
    expect(r.timeEntries.map((t) => t.narrative)).toEqual([
      "Privileged narrative",
    ]);
  });

  test("a removed team member is back to Busy", async () => {
    await prisma.matterTeamMember.create({
      data: {
        matterId,
        userId: viewerId,
        role: "co_counsel",
        removedAt: new Date(),
      },
    });
    const [r] = await getMatterEvents(matterId);
    expect(r.viewerCanSeeDetails).toBe(false);
    expect(r.title).toBe("Busy");
  });

  test("creator, attendee and show_details override each unlock", async () => {
    mockedGetUser.mockResolvedValue(creatorId);
    expect((await getMatterEvents(matterId))[0].viewerCanSeeDetails).toBe(true);

    mockedGetUser.mockResolvedValue(outsideUserId);
    expect((await getMatterEvents(matterId))[0].viewerCanSeeDetails).toBe(false);
    await prisma.calendarAttendee.create({
      data: {
        eventId: matterEventId,
        userId: outsideUserId,
        name: "Outside",
        status: "accepted",
      },
    });
    expect((await getMatterEvents(matterId))[0].viewerCanSeeDetails).toBe(true);

    mockedGetUser.mockResolvedValue(viewerId);
    expect((await getMatterEvents(matterId))[0].viewerCanSeeDetails).toBe(false);
    await prisma.calendarEvent.update({
      where: { id: matterEventId },
      data: { visibility: "show_details" },
    });
    expect((await getMatterEvents(matterId))[0].title).toBe("Strategy session");
  });
});

describe("event labels on sibling matter tabs — same Busy rule", () => {
  beforeEach(async () => {
    await prisma.deadline.create({
      data: {
        matterId,
        title: "File response",
        dueDate: new Date("2026-06-20T00:00:00Z"),
        eventId: matterEventId,
      },
    });
    await prisma.task.create({
      data: { matterId, title: "Prep witness", eventId: matterEventId },
    });
    await prisma.note.create({
      data: {
        matterId,
        authorId: creatorId,
        content: "<p>court note</p>",
        calendarEventId: matterEventId,
      },
    });
  });

  test("viewer who sees the event as Busy never gets its title in the From-event chip or note link", async () => {
    const [d] = await getMatterDeadlines(matterId);
    expect(d.spawnedFrom).toEqual({
      kind: "event",
      id: matterEventId,
      label: "Busy",
    });
    const [t] = await getMatterTasks(matterId);
    expect(t.spawnedFrom?.label).toBe("Busy");
    const [n] = await getMatterNotes(matterId);
    expect(n.link?.kind).toBe("event");
    expect(n.link?.label).toBe("Busy");
  });

  test("a viewer who can see the event gets the real title", async () => {
    mockedGetUser.mockResolvedValue(creatorId);
    const [d] = await getMatterDeadlines(matterId);
    expect(d.spawnedFrom?.label).toBe("Strategy session");
    const [t] = await getMatterTasks(matterId);
    expect(t.spawnedFrom?.label).toBe("Strategy session");
    const [n] = await getMatterNotes(matterId);
    expect(n.link?.label).toBe("Strategy session");
  });
});

// ── ADR-012: date-only deadlines / all-day events, overlap ─────────────
//
// Deadlines and all-day events are calendar dates stored at UTC midnight.
// The range the page passes is the viewer's local day/week as INSTANTS
// (Denver midnight = 06:00Z), so filtering them by that range put every
// due date one day early for anyone west of UTC.

describe("getCalendarItems — date-only values and overlap", () => {
  const DENVER = "America/Denver";
  /** Denver local day/week bounds as the page builds them. */
  const dayRange = (y: number, m: number, d: number, tz = DENVER) => ({
    start: instantInTz(y, m, d, 0, 0, tz),
    end: instantInTz(y, m, d, 23, 59, tz),
  });

  const mkDeadline = (title: string, dueDate: string) =>
    prisma.deadline.create({
      data: { matterId, title, dueDate: new Date(dueDate), kind: "critical" },
    });

  const titles = (items: Awaited<ReturnType<typeof getCalendarItems>>) =>
    items.map((i) => i.title).sort();

  test("day view: a deadline due the viewed day shows; tomorrow's and yesterday's do not", async () => {
    await mkDeadline("due Apr 12", "2026-04-12T00:00:00Z");
    await mkDeadline("due Apr 13", "2026-04-13T00:00:00Z");
    await mkDeadline("due Apr 14", "2026-04-14T00:00:00Z");
    const { start, end } = dayRange(2026, 4, 13);
    const items = await getCalendarItems(start, end, DENVER);
    expect(titles(items)).toEqual(["due Apr 13"]);
    const deadline = items.find((i) => i.kind === "deadline");
    // The row hands back the stored date-only value untouched; the
    // views key it with dateOnlyKey().
    expect(
      deadline?.kind === "deadline" && dateOnlyKey(deadline.dueDate)
    ).toBe("2026-04-13");
  });

  test("week view: Sunday through Saturday inclusive, nothing outside", async () => {
    await mkDeadline("Sat Apr 11", "2026-04-11T00:00:00Z");
    await mkDeadline("Sun Apr 12", "2026-04-12T00:00:00Z");
    await mkDeadline("Sat Apr 18", "2026-04-18T00:00:00Z");
    await mkDeadline("Sun Apr 19", "2026-04-19T00:00:00Z");
    const start = dayRange(2026, 4, 12).start;
    const end = dayRange(2026, 4, 18).end;
    const items = await getCalendarItems(start, end, DENVER);
    expect(titles(items)).toEqual(["Sat Apr 18", "Sun Apr 12"]);
  });

  test("legacy rows stored at a Denver laptop's local midnight still land on their day", async () => {
    await mkDeadline("legacy Apr 13", "2026-04-13T06:00:00Z");
    const { start, end } = dayRange(2026, 4, 13);
    expect(titles(await getCalendarItems(start, end, DENVER))).toEqual([
      "legacy Apr 13",
    ]);
  });

  test("the viewer's zone decides which day the range covers (Tokyo)", async () => {
    await mkDeadline("due Apr 13", "2026-04-13T00:00:00Z");
    await mkDeadline("due Apr 14", "2026-04-14T00:00:00Z");
    const { start, end } = dayRange(2026, 4, 13, "Asia/Tokyo");
    expect(titles(await getCalendarItems(start, end, "Asia/Tokyo"))).toEqual([
      "due Apr 13",
    ]);
  });

  test("zone defaults to the session user's profile zone when omitted", async () => {
    await mkDeadline("due Apr 13", "2026-04-13T00:00:00Z");
    const { start, end } = dayRange(2026, 4, 13);
    expect(titles(await getCalendarItems(start, end))).toEqual(["due Apr 13"]);
  });

  test("summary counts follow the same day-key rule", async () => {
    await mkDeadline("due Apr 12", "2026-04-12T00:00:00Z");
    await mkDeadline("due Apr 13", "2026-04-13T00:00:00Z");
    await prisma.deadline.create({
      data: {
        matterId,
        title: "manual Apr 13",
        dueDate: new Date("2026-04-13T00:00:00Z"),
        kind: "manual",
      },
    });
    const { start, end } = dayRange(2026, 4, 13);
    expect((await getCalendarItems(start, end, DENVER)).length).toBe(2);
  });

  test("an all-day event stored at UTC midnight shows on its own day view", async () => {
    await prisma.calendarEvent.create({
      data: {
        title: "Trial day",
        isAllDay: true,
        startTime: new Date("2026-04-13T00:00:00Z"),
        endTime: new Date("2026-04-13T00:00:00Z"),
        createdById: creatorId,
      },
    });
    const sameDay = dayRange(2026, 4, 13);
    expect(
      titles(await getCalendarItems(sameDay.start, sameDay.end, DENVER))
    ).toEqual(["Busy"]);
    const dayBefore = dayRange(2026, 4, 12);
    expect(
      await getCalendarItems(dayBefore.start, dayBefore.end, DENVER)
    ).toHaveLength(0);
    const dayAfter = dayRange(2026, 4, 14);
    expect(
      await getCalendarItems(dayAfter.start, dayAfter.end, DENVER)
    ).toHaveLength(0);
  });

  test("a multi-day all-day event appears in every day and week it covers", async () => {
    await prisma.calendarEvent.create({
      data: {
        title: "Trial",
        isAllDay: true,
        startTime: new Date("2026-07-10T00:00:00Z"), // Fri
        endTime: new Date("2026-07-13T00:00:00Z"), // Mon
        createdById: creatorId,
      },
    });
    for (const [y, m, d, expected] of [
      [2026, 7, 9, 0],
      [2026, 7, 10, 1],
      [2026, 7, 11, 1],
      [2026, 7, 12, 1],
      [2026, 7, 13, 1],
      [2026, 7, 14, 0],
    ] as const) {
      const r = dayRange(y, m, d);
      expect(
        (await getCalendarItems(r.start, r.end, DENVER)).length
      ).toBe(expected);
    }
    // The following week (Sun Jul 12 - Sat Jul 18) still shows it.
    const week = {
      start: dayRange(2026, 7, 12).start,
      end: dayRange(2026, 7, 18).end,
    };
    expect(
      (await getCalendarItems(week.start, week.end, DENVER)).length
    ).toBe(1);
  });

  test("a timed event that started before the range and runs into it is included", async () => {
    await prisma.calendarEvent.create({
      data: {
        title: "Overnight",
        startTime: new Date("2026-04-13T03:00:00Z"), // Apr 12 9 PM MDT
        endTime: new Date("2026-04-13T08:00:00Z"), // Apr 13 2 AM MDT
        createdById: creatorId,
      },
    });
    const { start, end } = dayRange(2026, 4, 13);
    expect((await getCalendarItems(start, end, DENVER)).length).toBe(1);
  });

  test("a timed event that ends exactly at the range start is not on that day", async () => {
    await prisma.calendarEvent.create({
      data: {
        title: "Ends at midnight",
        startTime: new Date("2026-04-13T05:00:00Z"),
        endTime: new Date("2026-04-13T06:00:00Z"), // Apr 13 00:00 MDT
        createdById: creatorId,
      },
    });
    const { start, end } = dayRange(2026, 4, 13);
    expect(await getCalendarItems(start, end, DENVER)).toHaveLength(0);
  });

  test("a zero-length timed event at the range start is included", async () => {
    await prisma.calendarEvent.create({
      data: {
        title: "Instant",
        startTime: new Date("2026-04-13T06:00:00Z"),
        endTime: new Date("2026-04-13T06:00:00Z"),
        createdById: creatorId,
      },
    });
    const { start, end } = dayRange(2026, 4, 13);
    expect(await getCalendarItems(start, end, DENVER)).toHaveLength(1);
  });
});
