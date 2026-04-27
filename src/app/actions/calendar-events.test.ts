/**
 * Integration tests for the calendar event update action.
 *
 * Focused on the v2 additions:
 *   - isAllDay toggle is read from the form's "on" checkbox value
 *   - attendees JSON is parsed, validated, and replace-all'd into
 *     the CalendarAttendee table inside the same transaction as
 *     the event update
 *   - existing attendees disappear when removed from the form's
 *     hidden field
 *   - missing-event guard
 *
 * The end-to-time validation + zod field errors are covered by
 * the schema's superRefine; we sanity-check end-before-start is
 * still rejected so the new attendees plumbing didn't accidentally
 * disable it.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { updateCalendarEvent } from "@/app/actions/calendar-events";
import { updateCalendarEventInitialState } from "@/lib/calendar-event-form";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

let userId: string;
let matterId: string;
let eventId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/test\.db$/);
});

beforeEach(async () => {
  await resetDb();
  const { firmId } = await seedFirm();
  const u = await seedUser({ firmId });
  userId = u.userId;
  const area = await seedPracticeArea();
  const m = await seedMatter({
    practiceAreaId: area.areaId,
    stageId: area.stageId,
    leadUserId: userId,
  });
  matterId = m.matterId;
  const ev = await prisma.calendarEvent.create({
    data: {
      matterId,
      title: "Strategy session",
      type: "meeting",
      startTime: new Date("2026-05-01T09:00:00Z"),
      endTime: new Date("2026-05-01T10:00:00Z"),
    },
    select: { id: true },
  });
  eventId = ev.id;
});

afterEach(() => {
  vi.clearAllMocks();
});

const buildForm = (overrides: Partial<Record<string, string>> = {}) => {
  const fd = new FormData();
  fd.set("title", overrides.title ?? "Updated title");
  fd.set("type", overrides.type ?? "meeting");
  fd.set("startTime", overrides.startTime ?? "2026-05-01T09:00");
  fd.set("endTime", overrides.endTime ?? "2026-05-01T10:00");
  fd.set("location", overrides.location ?? "");
  fd.set("zoomUrl", overrides.zoomUrl ?? "");
  fd.set("description", overrides.description ?? "");
  fd.set("attendees", overrides.attendees ?? "[]");
  if (overrides.isAllDay === "on") {
    fd.set("isAllDay", "on");
  }
  return fd;
};

describe("updateCalendarEvent — isAllDay", () => {
  test("checked checkbox flips isAllDay to true", async () => {
    const res = await updateCalendarEvent(
      eventId,
      updateCalendarEventInitialState,
      buildForm({ isAllDay: "on" })
    );
    expect(res.status).toBe("ok");
    const row = await prisma.calendarEvent.findUnique({ where: { id: eventId } });
    expect(row!.isAllDay).toBe(true);
  });

  test("unchecked (no isAllDay key) keeps it false", async () => {
    const res = await updateCalendarEvent(
      eventId,
      updateCalendarEventInitialState,
      buildForm()
    );
    expect(res.status).toBe("ok");
    const row = await prisma.calendarEvent.findUnique({ where: { id: eventId } });
    expect(row!.isAllDay).toBe(false);
  });
});

describe("updateCalendarEvent — attendees replace-all", () => {
  test("creates attendees from the JSON list", async () => {
    const res = await updateCalendarEvent(
      eventId,
      updateCalendarEventInitialState,
      buildForm({
        attendees: JSON.stringify([
          { name: "Opposing Counsel", email: "oc@example.com" },
          { name: "Witness", email: "" },
        ]),
      })
    );
    expect(res.status).toBe("ok");
    const rows = await prisma.calendarAttendee.findMany({
      where: { eventId },
      orderBy: { name: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.name).sort()).toEqual(["Opposing Counsel", "Witness"]);
    const oc = rows.find((r) => r.name === "Opposing Counsel")!;
    expect(oc.email).toBe("oc@example.com");
    const witness = rows.find((r) => r.name === "Witness")!;
    expect(witness.email).toBeNull();
    expect(rows.every((r) => r.status === "pending")).toBe(true);
  });

  test("empty list deletes existing attendees", async () => {
    await prisma.calendarAttendee.createMany({
      data: [
        { eventId, name: "Old A", status: "accepted" },
        { eventId, name: "Old B", status: "pending" },
      ],
    });

    const res = await updateCalendarEvent(
      eventId,
      updateCalendarEventInitialState,
      buildForm({ attendees: "[]" })
    );
    expect(res.status).toBe("ok");
    const remaining = await prisma.calendarAttendee.count({ where: { eventId } });
    expect(remaining).toBe(0);
  });

  test("replaces existing attendees (delete + recreate)", async () => {
    await prisma.calendarAttendee.create({
      data: { eventId, name: "Goes away", status: "pending" },
    });
    const res = await updateCalendarEvent(
      eventId,
      updateCalendarEventInitialState,
      buildForm({
        attendees: JSON.stringify([{ name: "New", email: "new@example.com" }]),
      })
    );
    expect(res.status).toBe("ok");
    const rows = await prisma.calendarAttendee.findMany({ where: { eventId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("New");
  });

  test("rejects malformed attendees JSON", async () => {
    const res = await updateCalendarEvent(
      eventId,
      updateCalendarEventInitialState,
      buildForm({ attendees: "not-json" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.attendees?.[0]).toMatch(/malformed/i);
  });

  test("rejects an attendee with empty name", async () => {
    const res = await updateCalendarEvent(
      eventId,
      updateCalendarEventInitialState,
      buildForm({
        attendees: JSON.stringify([{ name: "  ", email: "a@b.com" }]),
      })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.attendees?.[0]).toBeTruthy();
    // Event row should remain untouched — rejection is pre-transaction.
    const row = await prisma.calendarEvent.findUnique({ where: { id: eventId } });
    expect(row!.title).toBe("Strategy session"); // original
  });
});

describe("updateCalendarEvent — guards", () => {
  test("missing event id surfaces an error", async () => {
    const res = await updateCalendarEvent(
      "no-such-event",
      updateCalendarEventInitialState,
      buildForm()
    );
    expect(res.status).toBe("error");
    expect(res.errors?.title?.[0]).toMatch(/no longer exists/i);
  });

  test("end before start is still rejected (regression check)", async () => {
    const res = await updateCalendarEvent(
      eventId,
      updateCalendarEventInitialState,
      buildForm({
        startTime: "2026-05-01T12:00",
        endTime: "2026-05-01T11:00",
      })
    );
    expect(res.status).toBe("error");
    expect(
      res.errors?.endTime?.some((m) => /after start/i.test(m))
    ).toBe(true);
  });
});
