/**
 * Calendar mutations vs. private events (ADR-037) and the matter wall
 * (ADR-039). Real Postgres, firm in TEAM mode.
 *
 *   - a viewer who only sees a PRIVATE event as Busy can't move,
 *     update or delete it - even holding every events.* key;
 *   - the creator can still do all three;
 *   - an event on a matter the viewer can't access 404s on every
 *     mutation, and so does creating one on such a matter.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/permission-check", () => ({
  requirePermission: vi.fn().mockResolvedValue("x"),
  currentUserHasPermission: vi.fn().mockResolvedValue(true), // every key
}));
vi.mock("@/lib/firm", () => ({ getCurrentFirm: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/current-user-tz", () => ({
  getCurrentUserTimeZone: vi.fn(async () => "America/Denver"),
}));
vi.mock("@/lib/google/google-calendar-push", () => ({
  pushEventToGoogle: vi.fn().mockResolvedValue(undefined),
  deleteEventFromGoogle: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  moveCalendarEvent,
  updateCalendarEvent,
} from "@/app/actions/calendar-events";
import {
  createCalendarEventInitialState,
  updateCalendarEventInitialState,
} from "@/lib/calendar-event-form";
import {
  resetDb,
  seedCalendarEvent,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const mockedUser = vi.mocked(getCurrentUserId);
const move = {
  isAllDay: false,
  startTime: "2026-05-08T15:00:00.000Z",
  endTime: "2026-05-08T16:00:00.000Z",
};

let alice: string; // creator / on matter A
let bob: string; // not on matter A
let matterA: string;

beforeEach(async () => {
  await resetDb();
  const { firmId, defaultRoleId } = await seedFirm();
  await prisma.firm.update({
    where: { id: firmId },
    data: { matterVisibility: "TEAM" },
  });
  ({ userId: alice } = await seedUser({ firmId, roleIds: [defaultRoleId] }));
  ({ userId: bob } = await seedUser({ firmId, roleIds: [defaultRoleId] }));
  const { areaId, stageId } = await seedPracticeArea();
  ({ matterId: matterA } = await seedMatter({
    practiceAreaId: areaId,
    stageId,
    leadUserId: alice,
  }));
  mockedUser.mockResolvedValue(bob);
});

const startOf = async (id: string) =>
  (await prisma.calendarEvent.findUniqueOrThrow({ where: { id } })).startTime;

function editForm(attendeeUserId: string) {
  const fd = new FormData();
  fd.set("title", "Hijacked");
  fd.set("type", "meeting");
  fd.set("location", "");
  fd.set("zoomUrl", "");
  fd.set("description", "");
  fd.set("startTime", "2026-05-01T09:00");
  fd.set("endTime", "2026-05-01T10:00");
  fd.set(
    "attendees",
    JSON.stringify([{ kind: "user", userId: attendeeUserId, name: "U", email: "" }]),
  );
  return fd;
}

describe("private event (Busy to everyone but its creator)", () => {
  test("a Busy viewer holding every key cannot move, update or delete it", async () => {
    const { eventId } = await seedCalendarEvent({
      createdById: alice,
      title: "Alice private",
      visibility: "private",
      startTime: new Date("2026-05-01T15:00:00Z"),
      attendees: [{ userId: bob, name: "Bob" }], // even as an invitee
    });
    const before = await startOf(eventId);

    const moved = await moveCalendarEvent(eventId, move);
    expect(moved.ok).toBe(false);

    const updated = await updateCalendarEvent(
      eventId,
      updateCalendarEventInitialState,
      editForm(bob),
    );
    expect(updated.status).toBe("error");

    const deleted = await deleteCalendarEvent(eventId);
    expect(deleted.ok).toBe(false);

    const row = await prisma.calendarEvent.findUniqueOrThrow({
      where: { id: eventId },
    });
    expect(row.startTime).toEqual(before);
    expect(row.title).toBe("Alice private");
  });

  test("the creator can still move and delete it", async () => {
    const { eventId } = await seedCalendarEvent({
      createdById: alice,
      visibility: "private",
      startTime: new Date("2026-05-01T15:00:00Z"),
    });
    mockedUser.mockResolvedValue(alice);
    expect((await moveCalendarEvent(eventId, move)).ok).toBe(true);
    expect((await deleteCalendarEvent(eventId)).ok).toBe(true);
  });
});

describe("matter wall", () => {
  test("every mutation on an event of a hidden matter 404s", async () => {
    const { eventId } = await seedCalendarEvent({
      createdById: alice,
      matterId: matterA,
      startTime: new Date("2026-05-01T15:00:00Z"),
    });
    await expect(moveCalendarEvent(eventId, move)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(
      updateCalendarEvent(eventId, updateCalendarEventInitialState, editForm(bob)),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(deleteCalendarEvent(eventId)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await prisma.calendarEvent.count()).toBe(1);
  });

  test("creating an event on a hidden matter 404s; a team member can", async () => {
    const fd = (matterId: string) => {
      const f = editForm(bob);
      f.set("matterId", matterId);
      return f;
    };
    await expect(createCalendarEvent(createCalendarEventInitialState, fd(matterA))).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(await prisma.calendarEvent.count()).toBe(0);

    mockedUser.mockResolvedValue(alice);
    const f = editForm(alice);
    f.set("matterId", matterA);
    const res = await createCalendarEvent(createCalendarEventInitialState, f);
    expect(res.status).toBe("ok");
    expect(await prisma.calendarEvent.count()).toBe(1);
  });
});
