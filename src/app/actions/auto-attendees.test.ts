/**
 * Integration tests for the calendar auto-attendee defaults.
 *
 * Two paths exercised end-to-end:
 *
 *   1. createEventWithCaptures (matter event create) auto-
 *      attaches the matter team when autoAddTeamToNewEvents is
 *      effective-on, skips when off.
 *
 *   2. addMatterTeamMember auto-attaches the new member to
 *      every UPCOMING (startTime > now) event on the matter
 *      when autoAddTeamToUpcomingEvents is effective-on.
 *      Past events stay untouched.
 *
 * Permission gates are mocked at module level (covered
 * separately). `getCurrentFirm` is also mocked so the import
 * chain doesn't pull next-auth.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn().mockResolvedValue("test-user"),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/firm", () => ({
  getCurrentFirm: vi.fn(),
}));

import { getCurrentUserId } from "@/lib/current-user";
import { getCurrentFirm } from "@/lib/firm";
import { prisma } from "@/lib/prisma";
import { createEventWithCaptures } from "@/app/actions/captures";
import { addMatterTeamMember } from "@/app/actions/matters";
import { captureInitialState } from "@/lib/capture-schemas";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const mockedGetUser = vi.mocked(getCurrentUserId);
const mockedGetFirm = vi.mocked(getCurrentFirm);

let firmId: string;
let leadUserId: string;
let coCounselUserId: string;
let outsideUserId: string;
let matterId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/test\.db$/);
});

beforeEach(async () => {
  await resetDb();
  const f = await seedFirm();
  firmId = f.firmId;
  // Seed three users — two will be on the team (lead + co-
  // counsel), one is firm-only and stays off the matter to
  // confirm the auto-add doesn't pull in non-team users.
  const lead = await seedUser({ firmId, name: "Lead Attorney", email: "lead@firm.com" });
  leadUserId = lead.userId;
  const co = await seedUser({ firmId, name: "Co Counsel", email: "co@firm.com" });
  coCounselUserId = co.userId;
  const outside = await seedUser({ firmId, name: "Other Person", email: "other@firm.com" });
  outsideUserId = outside.userId;

  mockedGetUser.mockResolvedValue(leadUserId);
  mockedGetFirm.mockResolvedValue({
    id: firmId,
    name: "Test Firm LLC",
    shortName: null,
    ein: null,
    website: null,
    phone: null,
    email: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    zip: null,
    country: "US",
    establishedAt: null,
    logoUrl: null,
  });

  const a = await seedPracticeArea();
  const m = await seedMatter({
    practiceAreaId: a.areaId,
    stageId: a.stageId,
    leadUserId,
  });
  matterId = m.matterId;

  // Add the co-counsel as a separate team membership row so the
  // matter has 2 team members for the auto-add tests.
  await prisma.matterTeamMember.create({
    data: { matterId, userId: coCounselUserId, role: "co_counsel" },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

const buildEventForm = (overrides: Partial<Record<string, string>> = {}) => {
  const fd = new FormData();
  fd.set("title", overrides.title ?? "Strategy session");
  fd.set("type", overrides.type ?? "meeting");
  fd.set("startTime", overrides.startTime ?? "2026-06-01T09:00");
  fd.set("endTime", overrides.endTime ?? "2026-06-01T10:00");
  fd.set("location", overrides.location ?? "");
  fd.set("attachments", overrides.attachments ?? "[]");
  return fd;
};

describe("createEventWithCaptures — auto-add team", () => {
  test("attaches every active team member when autoAddTeamToNewEvents is on (firm default)", async () => {
    // Firm default is true (schema default); matter has no override.
    const res = await createEventWithCaptures(
      matterId,
      captureInitialState,
      buildEventForm()
    );
    expect(res.status).toBe("ok");

    const event = await prisma.calendarEvent.findFirstOrThrow({
      where: { matterId },
      include: { attendees: true },
    });
    // Lead + co-counsel = 2 attendees, both linked as users.
    expect(event.attendees).toHaveLength(2);
    const userIds = event.attendees.map((a) => a.userId).sort();
    expect(userIds).toEqual([leadUserId, coCounselUserId].sort());
    // Outside user (not on the team) is NOT auto-added.
    expect(userIds).not.toContain(outsideUserId);
  });

  test("does NOT attach team when matter override flips to false", async () => {
    await prisma.matter.update({
      where: { id: matterId },
      data: { autoAddTeamToNewEvents: false },
    });
    const res = await createEventWithCaptures(
      matterId,
      captureInitialState,
      buildEventForm()
    );
    expect(res.status).toBe("ok");
    const event = await prisma.calendarEvent.findFirstOrThrow({
      where: { matterId },
      include: { attendees: true },
    });
    expect(event.attendees).toHaveLength(0);
  });

  test("does NOT attach team when firm default is off and matter inherits", async () => {
    await prisma.firm.update({
      where: { id: firmId },
      data: { autoAddTeamToNewEvents: false },
    });
    const res = await createEventWithCaptures(
      matterId,
      captureInitialState,
      buildEventForm()
    );
    expect(res.status).toBe("ok");
    const event = await prisma.calendarEvent.findFirstOrThrow({
      where: { matterId },
      include: { attendees: true },
    });
    expect(event.attendees).toHaveLength(0);
  });

  test("matter override 'true' beats firm 'false'", async () => {
    await prisma.firm.update({
      where: { id: firmId },
      data: { autoAddTeamToNewEvents: false },
    });
    await prisma.matter.update({
      where: { id: matterId },
      data: { autoAddTeamToNewEvents: true },
    });
    const res = await createEventWithCaptures(
      matterId,
      captureInitialState,
      buildEventForm()
    );
    expect(res.status).toBe("ok");
    const event = await prisma.calendarEvent.findFirstOrThrow({
      where: { matterId },
      include: { attendees: true },
    });
    expect(event.attendees).toHaveLength(2);
  });

  test("removed (former) team members are NOT auto-added", async () => {
    // Soft-remove the co-counsel.
    await prisma.matterTeamMember.updateMany({
      where: { matterId, userId: coCounselUserId },
      data: { removedAt: new Date() },
    });
    const res = await createEventWithCaptures(
      matterId,
      captureInitialState,
      buildEventForm()
    );
    expect(res.status).toBe("ok");
    const event = await prisma.calendarEvent.findFirstOrThrow({
      where: { matterId },
      include: { attendees: true },
    });
    const userIds = event.attendees.map((a) => a.userId);
    expect(userIds).toEqual([leadUserId]);
  });
});

describe("addMatterTeamMember — auto-add to upcoming events", () => {
  beforeEach(async () => {
    // Seed two events on the matter:
    // - one in the past (shouldn't get the new member)
    // - one in the future (should)
    await prisma.calendarEvent.createMany({
      data: [
        {
          matterId,
          title: "Past event",
          type: "meeting",
          startTime: new Date("2020-01-01T10:00:00Z"),
          endTime: new Date("2020-01-01T11:00:00Z"),
        },
        {
          matterId,
          title: "Future event",
          type: "meeting",
          startTime: new Date("2099-01-01T10:00:00Z"),
          endTime: new Date("2099-01-01T11:00:00Z"),
        },
      ],
    });
  });

  test("attaches the new member to UPCOMING events only when effective-on", async () => {
    const fd = new FormData();
    fd.set("userId", outsideUserId);
    fd.set("role", "co_counsel");

    const res = await addMatterTeamMember(matterId, fd);
    expect(res.ok).toBe(true);

    const past = await prisma.calendarEvent.findFirstOrThrow({
      where: { matterId, title: "Past event" },
      include: { attendees: true },
    });
    const future = await prisma.calendarEvent.findFirstOrThrow({
      where: { matterId, title: "Future event" },
      include: { attendees: true },
    });
    // Past untouched.
    expect(past.attendees.find((a) => a.userId === outsideUserId)).toBeUndefined();
    // Future has the new member.
    expect(future.attendees.find((a) => a.userId === outsideUserId)).toBeDefined();
  });

  test("skips the auto-add when effective-off", async () => {
    await prisma.matter.update({
      where: { id: matterId },
      data: { autoAddTeamToUpcomingEvents: false },
    });
    const fd = new FormData();
    fd.set("userId", outsideUserId);
    fd.set("role", "co_counsel");
    await addMatterTeamMember(matterId, fd);

    const future = await prisma.calendarEvent.findFirstOrThrow({
      where: { matterId, title: "Future event" },
      include: { attendees: true },
    });
    expect(future.attendees.find((a) => a.userId === outsideUserId)).toBeUndefined();
  });

  test("doesn't double-add when the new member is already on an upcoming event", async () => {
    // Pre-attach as a stand-in for "they were a guest before
    // joining the team".
    const future = await prisma.calendarEvent.findFirstOrThrow({
      where: { matterId, title: "Future event" },
    });
    await prisma.calendarAttendee.create({
      data: {
        eventId: future.id,
        userId: outsideUserId,
        name: "Other Person",
        email: "other@firm.com",
        status: "accepted",
      },
    });

    const fd = new FormData();
    fd.set("userId", outsideUserId);
    fd.set("role", "co_counsel");
    await addMatterTeamMember(matterId, fd);

    const after = await prisma.calendarAttendee.findMany({
      where: { eventId: future.id, userId: outsideUserId },
    });
    expect(after).toHaveLength(1);
    // Original status preserved (we didn't overwrite the row).
    expect(after[0]!.status).toBe("accepted");
  });
});
