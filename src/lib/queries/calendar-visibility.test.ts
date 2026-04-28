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

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import {
  getCalendarEventById,
  getCalendarItems,
} from "@/lib/queries/calendar";
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
