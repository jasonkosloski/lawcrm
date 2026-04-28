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
vi.mock("@/lib/permission-check", () => ({
  // Action-logic tests assume the user passes the gate. The gate
  // itself is verified in the dedicated "RBAC gate" describe at
  // the bottom of this file.
  requirePermission: vi.fn().mockResolvedValue("test-user"),
  currentUserHasPermission: vi.fn().mockResolvedValue(true),
}));
// `getCurrentFirm` (used by the new attendee-create path) pulls
// in next-auth at module load. Stub the resolver so nothing in
// the auth chain has to resolve. Each test re-points the mock
// to whatever firm it just seeded.
vi.mock("@/lib/firm", () => ({
  getCurrentFirm: vi.fn(),
}));
// `createCalendarEvent` stamps `createdById` from the current
// user; the resolver pulls in next-auth, so mock the same way.
vi.mock("@/lib/current-user", () => ({
  getCurrentUserId: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import {
  createCalendarEvent,
  moveCalendarEvent,
  updateCalendarEvent,
} from "@/app/actions/calendar-events";
import { getCurrentFirm } from "@/lib/firm";
import { getCurrentUserId } from "@/lib/current-user";
import { requirePermission } from "@/lib/permission-check";
import {
  createCalendarEventInitialState,
  updateCalendarEventInitialState,
} from "@/lib/calendar-event-form";
import {
  resetDb,
  seedFirm,
  seedMatter,
  seedPracticeArea,
  seedUser,
} from "@/test/integration-helpers";

const mockedGetCurrentFirm = vi.mocked(getCurrentFirm);
const mockedGetCurrentUser = vi.mocked(getCurrentUserId);

let firmId: string;
let userId: string;
let matterId: string;
let eventId: string;

beforeAll(() => {
  expect(process.env.DATABASE_URL).toMatch(/test\.db$/);
});

beforeEach(async () => {
  await resetDb();
  const f = await seedFirm();
  firmId = f.firmId;
  // Point the mocked resolver at the just-seeded firm so the
  // attendee path can stamp Contact.firmId + scope its dup
  // check correctly.
  mockedGetCurrentFirm.mockResolvedValue({
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
  const u = await seedUser({ firmId });
  userId = u.userId;
  mockedGetCurrentUser.mockResolvedValue(userId);
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
  fd.set("location", overrides.location ?? "");
  fd.set("zoomUrl", overrides.zoomUrl ?? "");
  fd.set("description", overrides.description ?? "");
  fd.set("attendees", overrides.attendees ?? "[]");
  // All-day events post date-only (`YYYY-MM-DD`); timed events
  // post the full `YYYY-MM-DDTHH:mm`. The test helper picks the
  // right default based on the isAllDay flag, but a caller can
  // still override either side explicitly.
  if (overrides.isAllDay === "on") {
    fd.set("isAllDay", "on");
    fd.set("startTime", overrides.startTime ?? "2026-05-01");
    fd.set("endTime", overrides.endTime ?? "2026-05-01");
  } else {
    fd.set("startTime", overrides.startTime ?? "2026-05-01T09:00");
    fd.set("endTime", overrides.endTime ?? "2026-05-01T10:00");
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

  test("all-day accepts date-only (YYYY-MM-DD) and stores local midnight", async () => {
    const res = await updateCalendarEvent(
      eventId,
      updateCalendarEventInitialState,
      buildForm({
        isAllDay: "on",
        startTime: "2026-05-15",
        endTime: "2026-05-15",
      })
    );
    expect(res.status).toBe("ok");
    const row = await prisma.calendarEvent.findUnique({ where: { id: eventId } });
    expect(row!.isAllDay).toBe(true);
    // Stored as local midnight of the user-entered date.
    expect(row!.startTime.getFullYear()).toBe(2026);
    expect(row!.startTime.getMonth()).toBe(4); // 0-indexed: 4 = May
    expect(row!.startTime.getDate()).toBe(15);
    expect(row!.startTime.getHours()).toBe(0);
    expect(row!.startTime.getMinutes()).toBe(0);
  });

  test("all-day rejects datetime-local input (date-only required)", async () => {
    const res = await updateCalendarEvent(
      eventId,
      updateCalendarEventInitialState,
      buildForm({
        isAllDay: "on",
        startTime: "2026-05-15T09:00",
        endTime: "2026-05-15T10:00",
      })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.startTime?.[0]).toMatch(/start date/i);
  });

  test("all-day end-before-start (by date) is rejected", async () => {
    const res = await updateCalendarEvent(
      eventId,
      updateCalendarEventInitialState,
      buildForm({
        isAllDay: "on",
        startTime: "2026-05-15",
        endTime: "2026-05-14",
      })
    );
    expect(res.status).toBe("error");
    expect(
      res.errors?.endTime?.some((m) => /on or after start date/i.test(m))
    ).toBe(true);
  });

  test("all-day same-day (start === end) is allowed", async () => {
    const res = await updateCalendarEvent(
      eventId,
      updateCalendarEventInitialState,
      buildForm({
        isAllDay: "on",
        startTime: "2026-05-15",
        endTime: "2026-05-15",
      })
    );
    expect(res.status).toBe("ok");
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
          // Witness is added via an existing-contact link (kind=
          // contact) so it doesn't need an email — the linked
          // Contact has its own. Demonstrates that the email-
          // required rule only applies to the new-contact branch.
          {
            kind: "contact",
            contactId: (
              await prisma.contact.create({
                data: { name: "Witness", type: "witness" },
                select: { id: true },
              })
            ).id,
            name: "Witness",
            email: "",
          },
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
    expect(witness.contactId).not.toBeNull();
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

describe("updateCalendarEvent — typed attendee picker", () => {
  test("kind=user links the User row + snapshots name/email", async () => {
    // Reuse the seeded test user from beforeEach.
    const userRow = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });

    const res = await updateCalendarEvent(
      eventId,
      updateCalendarEventInitialState,
      buildForm({
        attendees: JSON.stringify([
          {
            kind: "user",
            userId,
            name: userRow!.name,
            email: userRow!.email,
          },
        ]),
      })
    );
    expect(res.status).toBe("ok");
    const rows = await prisma.calendarAttendee.findMany({
      where: { eventId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(userId);
    expect(rows[0]!.contactId).toBeNull();
    expect(rows[0]!.name).toBe(userRow!.name);
  });

  test("kind=contact links the Contact row", async () => {
    const c = await prisma.contact.create({
      data: { name: "Existing Co.", type: "vendor", email: "ex@co.com" },
      select: { id: true, name: true, email: true },
    });

    const res = await updateCalendarEvent(
      eventId,
      updateCalendarEventInitialState,
      buildForm({
        attendees: JSON.stringify([
          {
            kind: "contact",
            contactId: c.id,
            name: c.name,
            email: c.email,
          },
        ]),
      })
    );
    expect(res.status).toBe("ok");
    const rows = await prisma.calendarAttendee.findMany({
      where: { eventId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.contactId).toBe(c.id);
    expect(rows[0]!.userId).toBeNull();
  });

  test("kind=new creates a Contact (type=other) and links it", async () => {
    const beforeCount = await prisma.contact.count();
    const res = await updateCalendarEvent(
      eventId,
      updateCalendarEventInitialState,
      buildForm({
        attendees: JSON.stringify([
          { kind: "new", name: "Stranger Person", email: "s@p.com" },
        ]),
      })
    );
    expect(res.status).toBe("ok");
    const afterCount = await prisma.contact.count();
    expect(afterCount).toBe(beforeCount + 1);

    const newContact = await prisma.contact.findFirst({
      where: { name: "Stranger Person" },
    });
    expect(newContact).not.toBeNull();
    expect(newContact!.type).toBe("other");
    expect(newContact!.email).toBe("s@p.com");

    const rows = await prisma.calendarAttendee.findMany({
      where: { eventId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.contactId).toBe(newContact!.id);
    expect(rows[0]!.userId).toBeNull();
  });

  test("kind=user with a stale userId silently skips the link (snapshot still saved)", async () => {
    const res = await updateCalendarEvent(
      eventId,
      updateCalendarEventInitialState,
      buildForm({
        attendees: JSON.stringify([
          {
            kind: "user",
            userId: "no-such-user",
            name: "Display Only",
            email: "x@y.com",
          },
        ]),
      })
    );
    // The event still saves — we don't blow up on a stale id.
    // The attendee row carries the snapshot but no FK.
    expect(res.status).toBe("ok");
    const row = await prisma.calendarAttendee.findFirst({ where: { eventId } });
    expect(row!.userId).toBeNull();
    expect(row!.contactId).toBeNull();
    expect(row!.name).toBe("Display Only");
  });

  test("legacy attendee (no kind) is treated as kind=new and creates a Contact", async () => {
    const beforeCount = await prisma.contact.count();
    const res = await updateCalendarEvent(
      eventId,
      updateCalendarEventInitialState,
      buildForm({
        attendees: JSON.stringify([
          // Old shape — no `kind` field. Should still work via
          // the schema's default("new").
          { name: "Legacy Person", email: "l@p.com" },
        ]),
      })
    );
    expect(res.status).toBe("ok");
    expect(await prisma.contact.count()).toBe(beforeCount + 1);
  });

  test("kind=new without an email is rejected (email mandatory for new contacts)", async () => {
    const beforeCount = await prisma.contact.count();
    const res = await updateCalendarEvent(
      eventId,
      updateCalendarEventInitialState,
      buildForm({
        attendees: JSON.stringify([
          { kind: "new", name: "No Email Person", email: "" },
        ]),
      })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.attendees?.[0]).toMatch(/email/i);
    // Pre-transaction rejection — no Contact created, no event
    // fields touched.
    expect(await prisma.contact.count()).toBe(beforeCount);
  });

  test("kind=new with malformed email is rejected", async () => {
    const res = await updateCalendarEvent(
      eventId,
      updateCalendarEventInitialState,
      buildForm({
        attendees: JSON.stringify([
          { kind: "new", name: "Garbage Email", email: "not-an-email" },
        ]),
      })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.attendees?.[0]).toMatch(/valid email/i);
  });

  test("kind=new is rejected when the email already belongs to a contact in the firm", async () => {
    // Seed an existing contact in the same firm with the
    // colliding email.
    await prisma.contact.create({
      data: {
        firmId,
        name: "Already Here",
        email: "duplicate@example.com",
        type: "client",
      },
    });

    const beforeCount = await prisma.contact.count();
    const res = await updateCalendarEvent(
      eventId,
      updateCalendarEventInitialState,
      buildForm({
        attendees: JSON.stringify([
          {
            kind: "new",
            name: "Duplicate Person",
            email: "duplicate@example.com",
          },
        ]),
      })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.attendees?.[0]).toMatch(/already exists/i);
    expect(res.errors?.attendees?.[0]).toMatch(/Already Here/);
    // No Contact created — pre-transaction reject.
    expect(await prisma.contact.count()).toBe(beforeCount);
  });

  test("kind=new dup check is case-insensitive", async () => {
    await prisma.contact.create({
      data: {
        firmId,
        name: "Mixed Case Email",
        email: "Mixed.Case@Example.com",
        type: "client",
      },
    });
    const res = await updateCalendarEvent(
      eventId,
      updateCalendarEventInitialState,
      buildForm({
        attendees: JSON.stringify([
          {
            kind: "new",
            name: "Lower Caser",
            email: "mixed.case@example.com",
          },
        ]),
      })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.attendees?.[0]).toMatch(/already exists/i);
  });

  test("kind=new with two new entries sharing an email is rejected (in-list dup)", async () => {
    const res = await updateCalendarEvent(
      eventId,
      updateCalendarEventInitialState,
      buildForm({
        attendees: JSON.stringify([
          { kind: "new", name: "First", email: "same@example.com" },
          { kind: "new", name: "Second", email: "same@example.com" },
        ]),
      })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.attendees?.[0]).toMatch(/share the email/i);
  });

  test("kind=new stamps Contact.firmId so the new row joins the firm directory", async () => {
    await updateCalendarEvent(
      eventId,
      updateCalendarEventInitialState,
      buildForm({
        attendees: JSON.stringify([
          {
            kind: "new",
            name: "Firm Scoped",
            email: "scoped@example.com",
          },
        ]),
      })
    );
    const created = await prisma.contact.findFirst({
      where: { name: "Firm Scoped" },
    });
    expect(created!.firmId).toBe(firmId);
  });

  test("kind=user attendee gets status='accepted' (firm member implicitly attending)", async () => {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await updateCalendarEvent(
      eventId,
      updateCalendarEventInitialState,
      buildForm({
        attendees: JSON.stringify([
          { kind: "user", userId, name: u.name, email: u.email },
        ]),
      })
    );
    const row = await prisma.calendarAttendee.findFirstOrThrow({
      where: { eventId },
    });
    expect(row.status).toBe("accepted");
  });

  test("kind=contact attendee stays status='pending' (RSVP awaits real flow)", async () => {
    const c = await prisma.contact.create({
      data: { name: "Outside Person", type: "vendor", email: "o@p.com" },
      select: { id: true, name: true, email: true },
    });
    await updateCalendarEvent(
      eventId,
      updateCalendarEventInitialState,
      buildForm({
        attendees: JSON.stringify([
          { kind: "contact", contactId: c.id, name: c.name, email: c.email },
        ]),
      })
    );
    const row = await prisma.calendarAttendee.findFirstOrThrow({
      where: { eventId },
    });
    expect(row.status).toBe("pending");
  });

  test("kind=new attendee stays status='pending' (RSVP awaits real flow)", async () => {
    await updateCalendarEvent(
      eventId,
      updateCalendarEventInitialState,
      buildForm({
        attendees: JSON.stringify([
          { kind: "new", name: "Brand New", email: "brand@new.com" },
        ]),
      })
    );
    const row = await prisma.calendarAttendee.findFirstOrThrow({
      where: { eventId },
    });
    expect(row.status).toBe("pending");
  });

  test("kind=user with empty email is allowed (linked user has its own)", async () => {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const res = await updateCalendarEvent(
      eventId,
      updateCalendarEventInitialState,
      buildForm({
        attendees: JSON.stringify([
          // The picker stores the linked user's email as a
          // snapshot, but the rule's only enforced for the new-
          // contact branch — picking a user with an empty email
          // override should still pass.
          { kind: "user", userId, name: u.name, email: "" },
        ]),
      })
    );
    expect(res.status).toBe("ok");
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

// ── moveCalendarEvent ───────────────────────────────────────────────────

describe("moveCalendarEvent — drag-and-drop reschedule", () => {
  test("moves a timed event to a new time slot, preserves duration", async () => {
    const newStart = new Date("2026-05-08T14:00:00.000Z");
    const newEnd = new Date("2026-05-08T15:00:00.000Z"); // 1h
    const res = await moveCalendarEvent(eventId, {
      isAllDay: false,
      startTime: newStart.toISOString(),
      endTime: newEnd.toISOString(),
    });
    expect(res.ok).toBe(true);
    const row = await prisma.calendarEvent.findUnique({ where: { id: eventId } });
    expect(row!.startTime.toISOString()).toBe(newStart.toISOString());
    expect(row!.endTime.toISOString()).toBe(newEnd.toISOString());
    expect(row!.isAllDay).toBe(false);
  });

  test("flips a timed event to all-day", async () => {
    const day = new Date("2026-05-08T00:00:00.000Z");
    const res = await moveCalendarEvent(eventId, {
      isAllDay: true,
      startTime: day.toISOString(),
      endTime: day.toISOString(),
    });
    expect(res.ok).toBe(true);
    const row = await prisma.calendarEvent.findUnique({ where: { id: eventId } });
    expect(row!.isAllDay).toBe(true);
    expect(row!.startTime.toISOString()).toBe(day.toISOString());
    expect(row!.endTime.toISOString()).toBe(day.toISOString());
  });

  test("flips an all-day event to a timed slot", async () => {
    // Set the event to all-day first.
    await prisma.calendarEvent.update({
      where: { id: eventId },
      data: {
        isAllDay: true,
        startTime: new Date("2026-05-08T00:00:00.000Z"),
        endTime: new Date("2026-05-08T00:00:00.000Z"),
      },
    });
    const newStart = new Date("2026-05-08T13:00:00.000Z");
    const newEnd = new Date("2026-05-08T15:00:00.000Z"); // 2h default
    const res = await moveCalendarEvent(eventId, {
      isAllDay: false,
      startTime: newStart.toISOString(),
      endTime: newEnd.toISOString(),
    });
    expect(res.ok).toBe(true);
    const row = await prisma.calendarEvent.findUnique({ where: { id: eventId } });
    expect(row!.isAllDay).toBe(false);
    expect(row!.endTime.getTime() - row!.startTime.getTime()).toBe(
      2 * 60 * 60 * 1000
    );
  });

  test("rejects when the event is missing", async () => {
    const res = await moveCalendarEvent("no-such-id", {
      isAllDay: false,
      startTime: new Date("2026-05-08T09:00:00Z").toISOString(),
      endTime: new Date("2026-05-08T10:00:00Z").toISOString(),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });

  test("rejects end-before-start", async () => {
    const res = await moveCalendarEvent(eventId, {
      isAllDay: false,
      startTime: new Date("2026-05-08T15:00:00Z").toISOString(),
      endTime: new Date("2026-05-08T14:00:00Z").toISOString(),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/on or after start/i);
  });

  test("rejects unparseable timestamps", async () => {
    const res = await moveCalendarEvent(eventId, {
      isAllDay: false,
      startTime: "not-a-date",
      endTime: new Date("2026-05-08T10:00:00Z").toISOString(),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/invalid/i);
  });

  test("gates on events.edit", async () => {
    const mocked = vi.mocked(requirePermission);
    mocked.mockClear();
    await moveCalendarEvent(eventId, {
      isAllDay: false,
      startTime: new Date("2026-05-08T09:00:00Z").toISOString(),
      endTime: new Date("2026-05-08T10:00:00Z").toISOString(),
    });
    expect(mocked).toHaveBeenCalledWith("events.edit");
  });
});

// ── createCalendarEvent ────────────────────────────────────────────────

describe("createCalendarEvent", () => {
  const buildForm = (overrides: Partial<Record<string, string>> = {}) => {
    const fd = new FormData();
    fd.set("title", overrides.title ?? "Block focus time");
    fd.set("type", overrides.type ?? "block_time");
    fd.set("location", overrides.location ?? "");
    fd.set("zoomUrl", overrides.zoomUrl ?? "");
    fd.set("description", overrides.description ?? "");
    if (overrides.matterId !== undefined) fd.set("matterId", overrides.matterId);
    if (overrides.isAllDay === "on") {
      fd.set("isAllDay", "on");
      fd.set("startTime", overrides.startTime ?? "2026-06-01");
      fd.set("endTime", overrides.endTime ?? "2026-06-01");
    } else {
      fd.set("startTime", overrides.startTime ?? "2026-06-01T13:00");
      fd.set("endTime", overrides.endTime ?? "2026-06-01T14:00");
    }
    return fd;
  };

  test("no matterId → matterless event, createdById stamped", async () => {
    const res = await createCalendarEvent(
      createCalendarEventInitialState,
      buildForm()
    );
    expect(res.status).toBe("ok");
    const row = await prisma.calendarEvent.findUniqueOrThrow({
      where: { id: res.eventId! },
    });
    expect(row.matterId).toBeNull();
    expect(row.createdById).toBe(userId);
    expect(row.title).toBe("Block focus time");
  });

  test("with matterId → matter-scoped event, createdById still stamped", async () => {
    const res = await createCalendarEvent(
      createCalendarEventInitialState,
      buildForm({ matterId, title: "Strategy session" })
    );
    expect(res.status).toBe("ok");
    const row = await prisma.calendarEvent.findUniqueOrThrow({
      where: { id: res.eventId! },
    });
    expect(row.matterId).toBe(matterId);
    expect(row.createdById).toBe(userId);
  });

  test("empty matterId string is treated as no matter", async () => {
    const res = await createCalendarEvent(
      createCalendarEventInitialState,
      buildForm({ matterId: "" })
    );
    expect(res.status).toBe("ok");
    const row = await prisma.calendarEvent.findUniqueOrThrow({
      where: { id: res.eventId! },
    });
    expect(row.matterId).toBeNull();
  });

  test("rejects empty title", async () => {
    const res = await createCalendarEvent(
      createCalendarEventInitialState,
      buildForm({ title: "   " })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.title?.length).toBeGreaterThan(0);
  });

  test("rejects end-before-start", async () => {
    const res = await createCalendarEvent(
      createCalendarEventInitialState,
      buildForm({
        startTime: "2026-06-01T15:00",
        endTime: "2026-06-01T14:00",
      })
    );
    expect(res.status).toBe("error");
    expect(
      res.errors?.endTime?.some((m) => /after start/i.test(m))
    ).toBe(true);
  });

  test("all-day uses date-only inputs and stores local midnight", async () => {
    const res = await createCalendarEvent(
      createCalendarEventInitialState,
      buildForm({
        isAllDay: "on",
        startTime: "2026-06-15",
        endTime: "2026-06-15",
      })
    );
    expect(res.status).toBe("ok");
    const row = await prisma.calendarEvent.findUniqueOrThrow({
      where: { id: res.eventId! },
    });
    expect(row.isAllDay).toBe(true);
    expect(row.startTime.getHours()).toBe(0);
    expect(row.startTime.getDate()).toBe(15);
  });

  test("gates on events.create", async () => {
    const mocked = vi.mocked(requirePermission);
    mocked.mockClear();
    await createCalendarEvent(
      createCalendarEventInitialState,
      buildForm()
    );
    expect(mocked).toHaveBeenCalledWith("events.create");
  });
});
