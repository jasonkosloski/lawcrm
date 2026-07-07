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
  deleteCalendarEvent,
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
  expect(process.env.DATABASE_URL).toMatch(/lawcrm_test/);
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

/** Default firm-user attendee — the seeded `userId`. The
 *  min-firm-attendee invariant in `updateCalendarEvent`
 *  requires at least one `kind: "user"` attendee, so the
 *  helper auto-prepends the test user when a caller's
 *  override doesn't already include one. Tests that want to
 *  exercise the empty-list branch can pass `attendees:
 *  "[]"` AND set `__skipDefaultUser: "1"` to bypass. */
const buildForm = (
  overrides: Partial<Record<string, string>> & {
    __skipDefaultUser?: string;
  } = {}
) => {
  const fd = new FormData();
  fd.set("title", overrides.title ?? "Updated title");
  fd.set("type", overrides.type ?? "meeting");
  fd.set("location", overrides.location ?? "");
  fd.set("zoomUrl", overrides.zoomUrl ?? "");
  fd.set("description", overrides.description ?? "");
  // Attendee list — auto-prepend the seeded user when the
  // caller's list is empty or doesn't already include them.
  let attendees = overrides.attendees ?? "[]";
  if (overrides.__skipDefaultUser !== "1") {
    try {
      const parsed = JSON.parse(attendees) as Array<Record<string, unknown>>;
      const hasUser = parsed.some(
        (a) => a.kind === "user" && a.userId === userId
      );
      if (!hasUser) {
        attendees = JSON.stringify([
          { kind: "user", userId, name: "Test User", email: "" },
          ...parsed,
        ]);
      }
    } catch {
      // Non-JSON override (e.g. malformed-payload test) —
      // pass through untouched so the test gets the rejection
      // it's exercising.
    }
  }
  fd.set("attendees", attendees);
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
    // The buildForm helper prepends the seeded user to satisfy
    // the min-firm-attendee invariant — assert on the
    // contact-only rows we explicitly added.
    const rows = await prisma.calendarAttendee.findMany({
      where: { eventId, userId: null },
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
      // Empty user-input list — buildForm auto-prepends the
      // seeded user to satisfy the min-firm-attendee rule.
      // After save the only attendee is that single user; the
      // pre-existing "Old A" / "Old B" rows were deleted.
      buildForm({ attendees: "[]" })
    );
    expect(res.status).toBe("ok");
    const remaining = await prisma.calendarAttendee.findMany({
      where: { eventId },
    });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.userId).toBe(userId);
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
    // buildForm auto-prepends the seeded firm user — assert on the
    // contact-only row to confirm the old attendee was replaced.
    const rows = await prisma.calendarAttendee.findMany({
      where: { eventId, userId: null },
    });
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
    // Filter past the auto-prepended seeded user so we assert on the
    // contact attendee we explicitly added.
    const rows = await prisma.calendarAttendee.findMany({
      where: { eventId, userId: null },
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

    // Filter past the auto-prepended seeded user.
    const rows = await prisma.calendarAttendee.findMany({
      where: { eventId, userId: null },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.contactId).toBe(newContact!.id);
    expect(rows[0]!.userId).toBeNull();
  });

  test("kind=user with a stale userId fails the save (no null/null attendee row)", async () => {
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
    // Stale ids reject pre-transaction — the alternative (silent
    // skip) writes an attendee row with BOTH FKs null and can
    // dodge the min-firm-attendee invariant.
    expect(res.status).toBe("error");
    expect(res.errors?.attendees?.[0]).toMatch(/no longer an active firm user/i);
    expect(
      await prisma.calendarAttendee.count({ where: { eventId } })
    ).toBe(0);
    const row = await prisma.calendarEvent.findUnique({ where: { id: eventId } });
    expect(row!.title).toBe("Strategy session"); // untouched
  });

  test("kind=user pointing at a deactivated user can't satisfy the min-firm-attendee rule", async () => {
    const inactive = await seedUser({
      firmId,
      name: "Departed",
      email: "gone@x.com",
    });
    await prisma.user.update({
      where: { id: inactive.userId },
      data: { isActive: false },
    });
    const res = await updateCalendarEvent(
      eventId,
      updateCalendarEventInitialState,
      buildForm({
        __skipDefaultUser: "1",
        attendees: JSON.stringify([
          {
            kind: "user",
            userId: inactive.userId,
            name: "Departed",
            email: "gone@x.com",
          },
        ]),
      })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.attendees?.[0]).toMatch(/no longer an active firm user/i);
  });

  test("kind=user with an empty userId is rejected — does NOT mint a Contact", async () => {
    // A stale client payload with kind=user but no id skipped both
    // the email-required superRefine and the dup-email pre-check
    // (both only cover kind=new); it must never reach the
    // create-a-Contact branch.
    const beforeCount = await prisma.contact.count();
    const res = await updateCalendarEvent(
      eventId,
      updateCalendarEventInitialState,
      buildForm({
        attendees: JSON.stringify([
          { kind: "user", userId: "", name: "Ghost", email: "" },
        ]),
      })
    );
    expect(res.status).toBe("error");
    expect(await prisma.contact.count()).toBe(beforeCount);
  });

  test("kind=contact with a stale contactId fails the save — does NOT mint a Contact", async () => {
    const beforeCount = await prisma.contact.count();
    const res = await updateCalendarEvent(
      eventId,
      updateCalendarEventInitialState,
      buildForm({
        attendees: JSON.stringify([
          {
            kind: "contact",
            contactId: "no-such-contact",
            name: "Vanished Co.",
            email: "",
          },
        ]),
      })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.attendees?.[0]).toMatch(/no longer matches an active contact/i);
    expect(await prisma.contact.count()).toBe(beforeCount);
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
    // Skip the auto-prepended seeded user; assert on the contact row.
    const row = await prisma.calendarAttendee.findFirstOrThrow({
      where: { eventId, contactId: c.id },
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
    // Skip the auto-prepended seeded user; assert on the new-contact row.
    const row = await prisma.calendarAttendee.findFirstOrThrow({
      where: { eventId, name: "Brand New" },
    });
    expect(row.status).toBe("pending");
  });

  test("rejects when no firm-user attendees remain (every event needs ≥1)", async () => {
    const res = await updateCalendarEvent(
      eventId,
      updateCalendarEventInitialState,
      buildForm({
        __skipDefaultUser: "1",
        attendees: JSON.stringify([
          { kind: "new", name: "External Only", email: "ext@x.com" },
        ]),
      })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.attendees?.[0]).toMatch(/at least one firm attendee/i);
  });

  test("rejects when attendee list is empty (every event needs ≥1)", async () => {
    const res = await updateCalendarEvent(
      eventId,
      updateCalendarEventInitialState,
      buildForm({ __skipDefaultUser: "1", attendees: "[]" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.attendees?.[0]).toMatch(/at least one firm attendee/i);
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

  // Gate parity with updateCalendarEvent: the drag path runs the
  // same canEditEvent resolver, so events.edit alone must not move
  // another user's personal event, and a creator without any edit
  // perms must still be able to drag their own.
  const moveInput = {
    isAllDay: false,
    startTime: new Date("2026-05-08T09:00:00Z").toISOString(),
    endTime: new Date("2026-05-08T10:00:00Z").toISOString(),
  };

  test("creator can move their own personal event without any edit perms", async () => {
    const personal = await prisma.calendarEvent.create({
      data: {
        title: "Dentist",
        type: "personal",
        startTime: new Date("2026-05-01T09:00:00Z"),
        endTime: new Date("2026-05-01T10:00:00Z"),
        createdById: userId,
      },
      select: { id: true },
    });
    const { currentUserHasPermission } = await import(
      "@/lib/permission-check"
    );
    vi.mocked(currentUserHasPermission).mockResolvedValue(false);
    const res = await moveCalendarEvent(personal.id, moveInput);
    expect(res.ok).toBe(true);
    const row = await prisma.calendarEvent.findUniqueOrThrow({
      where: { id: personal.id },
    });
    expect(row.startTime.toISOString()).toBe(moveInput.startTime);
  });

  test("events.edit alone cannot move another user's personal event", async () => {
    const other = await seedUser({
      firmId,
      name: "Move Target",
      email: "movetarget@x.com",
    });
    const personal = await prisma.calendarEvent.create({
      data: {
        title: "Private slot",
        type: "personal",
        startTime: new Date("2026-05-01T09:00:00Z"),
        endTime: new Date("2026-05-01T10:00:00Z"),
        createdById: other.userId,
      },
      select: { id: true },
    });
    const { currentUserHasPermission } = await import(
      "@/lib/permission-check"
    );
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (key: string) => key === "events.edit"
    );
    const res = await moveCalendarEvent(personal.id, moveInput);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/permission/i);
    const row = await prisma.calendarEvent.findUniqueOrThrow({
      where: { id: personal.id },
    });
    expect(row.startTime.toISOString()).toBe("2026-05-01T09:00:00.000Z"); // unchanged
  });

  test("events.edit_non_matter unlocks moving another user's personal event", async () => {
    const other = await seedUser({
      firmId,
      name: "Move Target 2",
      email: "movetarget2@x.com",
    });
    const personal = await prisma.calendarEvent.create({
      data: {
        title: "Private slot",
        type: "personal",
        startTime: new Date("2026-05-01T09:00:00Z"),
        endTime: new Date("2026-05-01T10:00:00Z"),
        createdById: other.userId,
      },
      select: { id: true },
    });
    const { currentUserHasPermission } = await import(
      "@/lib/permission-check"
    );
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (key: string) => key === "events.edit_non_matter"
    );
    const res = await moveCalendarEvent(personal.id, moveInput);
    expect(res.ok).toBe(true);
  });

  test("non-creator without events.edit cannot move a matter event", async () => {
    // The seeded matter event has no createdById → no creator
    // bypass; without events.edit the matter branch rejects.
    const { currentUserHasPermission } = await import(
      "@/lib/permission-check"
    );
    vi.mocked(currentUserHasPermission).mockResolvedValue(false);
    const res = await moveCalendarEvent(eventId, moveInput);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/permission/i);
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

  test("visibility defaults to 'default' when the form omits the field", async () => {
    // Backwards-compat path — older clients that don't post the
    // hidden `visibility` field still need to create events that
    // default-deny to non-attendees.
    const res = await createCalendarEvent(
      createCalendarEventInitialState,
      buildForm()
    );
    expect(res.status).toBe("ok");
    const row = await prisma.calendarEvent.findUniqueOrThrow({
      where: { id: res.eventId! },
    });
    expect(row.visibility).toBe("default");
  });

  test("visibility='show_details' from the form is persisted", async () => {
    const fd = buildForm();
    fd.set("visibility", "show_details");
    const res = await createCalendarEvent(
      createCalendarEventInitialState,
      fd
    );
    expect(res.status).toBe("ok");
    const row = await prisma.calendarEvent.findUniqueOrThrow({
      where: { id: res.eventId! },
    });
    expect(row.visibility).toBe("show_details");
  });

  test("visibility rejects unknown enum values (tampered form)", async () => {
    const fd = buildForm();
    fd.set("visibility", "private"); // not a valid value
    const res = await createCalendarEvent(
      createCalendarEventInitialState,
      fd
    );
    expect(res.status).toBe("error");
    expect(res.errors?.visibility?.length).toBeGreaterThan(0);
  });

  // ── Attendees at create time (full-page form) ─────────────────────────

  test("no attendees field → creator auto-added (quick-composer compat)", async () => {
    const res = await createCalendarEvent(
      createCalendarEventInitialState,
      buildForm()
    );
    expect(res.status).toBe("ok");
    const rows = await prisma.calendarAttendee.findMany({
      where: { eventId: res.eventId! },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(userId);
    expect(rows[0]!.status).toBe("accepted");
  });

  test("kind=user attendee is linked; creator still auto-added alongside", async () => {
    const other = await seedUser({
      firmId,
      name: "Colleague",
      email: "colleague@x.com",
    });
    const fd = buildForm();
    fd.set(
      "attendees",
      JSON.stringify([
        { kind: "user", userId: other.userId, name: "Colleague", email: "" },
      ])
    );
    const res = await createCalendarEvent(createCalendarEventInitialState, fd);
    expect(res.status).toBe("ok");
    const rows = await prisma.calendarAttendee.findMany({
      where: { eventId: res.eventId! },
      orderBy: { name: "asc" },
    });
    expect(rows).toHaveLength(2);
    const ids = rows.map((r) => r.userId).sort();
    expect(ids).toEqual([other.userId, userId].sort());
    expect(rows.every((r) => r.status === "accepted")).toBe(true);
  });

  test("creator included in the posted list is not duplicated", async () => {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const fd = buildForm();
    fd.set(
      "attendees",
      JSON.stringify([
        { kind: "user", userId, name: u.name, email: u.email },
      ])
    );
    const res = await createCalendarEvent(createCalendarEventInitialState, fd);
    expect(res.status).toBe("ok");
    const rows = await prisma.calendarAttendee.findMany({
      where: { eventId: res.eventId! },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(userId);
  });

  test("kind=contact attendee is linked pending; external-only list is NOT an error (creator fills the invariant)", async () => {
    const c = await prisma.contact.create({
      data: { name: "Outside Counsel", type: "vendor", email: "oc@x.com" },
      select: { id: true, name: true, email: true },
    });
    const fd = buildForm();
    fd.set(
      "attendees",
      JSON.stringify([
        { kind: "contact", contactId: c.id, name: c.name, email: c.email },
      ])
    );
    const res = await createCalendarEvent(createCalendarEventInitialState, fd);
    expect(res.status).toBe("ok");
    const rows = await prisma.calendarAttendee.findMany({
      where: { eventId: res.eventId! },
    });
    expect(rows).toHaveLength(2); // creator + contact
    const contactRow = rows.find((r) => r.contactId === c.id)!;
    expect(contactRow.status).toBe("pending");
    expect(rows.some((r) => r.userId === userId)).toBe(true);
  });

  test("kind=new mints a firm-stamped Contact (type=other), pending", async () => {
    const before = await prisma.contact.count();
    const fd = buildForm();
    fd.set(
      "attendees",
      JSON.stringify([
        { kind: "new", name: "Fresh Face", email: "fresh@face.com" },
      ])
    );
    const res = await createCalendarEvent(createCalendarEventInitialState, fd);
    expect(res.status).toBe("ok");
    expect(await prisma.contact.count()).toBe(before + 1);
    const minted = await prisma.contact.findFirstOrThrow({
      where: { name: "Fresh Face" },
    });
    expect(minted.type).toBe("other");
    expect(minted.firmId).toBe(firmId);
    const row = await prisma.calendarAttendee.findFirstOrThrow({
      where: { eventId: res.eventId!, contactId: minted.id },
    });
    expect(row.status).toBe("pending");
  });

  test("malformed attendees JSON rejects — no event created", async () => {
    const before = await prisma.calendarEvent.count();
    const fd = buildForm();
    fd.set("attendees", "not-json");
    const res = await createCalendarEvent(createCalendarEventInitialState, fd);
    expect(res.status).toBe("error");
    expect(res.errors?.attendees?.[0]).toMatch(/malformed/i);
    expect(await prisma.calendarEvent.count()).toBe(before);
  });

  test("kind=new without an email rejects — no event, no Contact", async () => {
    const beforeEvents = await prisma.calendarEvent.count();
    const beforeContacts = await prisma.contact.count();
    const fd = buildForm();
    fd.set(
      "attendees",
      JSON.stringify([{ kind: "new", name: "No Email", email: "" }])
    );
    const res = await createCalendarEvent(createCalendarEventInitialState, fd);
    expect(res.status).toBe("error");
    expect(res.errors?.attendees?.[0]).toMatch(/email/i);
    expect(await prisma.calendarEvent.count()).toBe(beforeEvents);
    expect(await prisma.contact.count()).toBe(beforeContacts);
  });

  test("stale contactId rejects pre-write — no event created", async () => {
    const before = await prisma.calendarEvent.count();
    const fd = buildForm();
    fd.set(
      "attendees",
      JSON.stringify([
        { kind: "contact", contactId: "no-such-contact", name: "Ghost", email: "" },
      ])
    );
    const res = await createCalendarEvent(createCalendarEventInitialState, fd);
    expect(res.status).toBe("error");
    expect(res.errors?.attendees?.[0]).toMatch(/no longer matches/i);
    expect(await prisma.calendarEvent.count()).toBe(before);
  });

  test("kind=new colliding with an existing firm contact's email rejects", async () => {
    await prisma.contact.create({
      data: {
        firmId,
        name: "Taken Email",
        email: "taken@example.com",
        type: "client",
      },
    });
    const fd = buildForm();
    fd.set(
      "attendees",
      JSON.stringify([
        { kind: "new", name: "Duplicate", email: "taken@example.com" },
      ])
    );
    const res = await createCalendarEvent(createCalendarEventInitialState, fd);
    expect(res.status).toBe("error");
    expect(res.errors?.attendees?.[0]).toMatch(/already exists/i);
  });
});

// ── updateCalendarEvent edit-gate (visibility model) ───────────────────
//
// The action runs `canEditEvent` server-side regardless of what the
// client sent. These tests exercise the three branches:
//
//   1. Creator bypass — the creator can always edit, no perms needed.
//   2. Matter event — needs `events.edit`. (Already covered above by
//      the bulk of the test suite, which mocks events.edit as true;
//      the explicit "missing events.edit on a non-creator's matter
//      event" case lives below.)
//   3. Non-matter event — needs `events.edit_non_matter` for non-
//      creator viewers. `events.edit` alone does NOT suffice; that
//      separation is the whole point of the new permission.
//
// `currentUserHasPermission` is the resolver the action uses for the
// per-key permission check; we re-point its return values per test.

describe("updateCalendarEvent — edit gate (visibility model)", () => {
  const buildEditForm = (overrides: Partial<Record<string, string>> = {}) => {
    const fd = new FormData();
    fd.set("title", overrides.title ?? "Edited title");
    fd.set("type", overrides.type ?? "meeting");
    fd.set("location", "");
    fd.set("zoomUrl", "");
    fd.set("description", "");
    fd.set("startTime", "2026-05-01T09:00");
    fd.set("endTime", "2026-05-01T10:00");
    // Auto-include the seeded user so the min-firm-attendee gate
    // doesn't trip first — we want the edit gate to be the failure.
    fd.set(
      "attendees",
      JSON.stringify([
        { kind: "user", userId, name: "Test User", email: "" },
      ])
    );
    return fd;
  };

  test("creator can edit their own non-matter event without any edit perms", async () => {
    // Personal event the seeded user (= viewer) created. Both
    // edit perms off — creator bypass should still succeed.
    const personal = await prisma.calendarEvent.create({
      data: {
        title: "Therapy",
        type: "personal",
        startTime: new Date("2026-05-01T09:00:00Z"),
        endTime: new Date("2026-05-01T10:00:00Z"),
        createdById: userId,
      },
      select: { id: true },
    });
    const { currentUserHasPermission } = await import(
      "@/lib/permission-check"
    );
    const mockedHas = vi.mocked(currentUserHasPermission);
    mockedHas.mockResolvedValue(false);
    const res = await updateCalendarEvent(
      personal.id,
      updateCalendarEventInitialState,
      buildEditForm({ title: "Therapy renamed" })
    );
    expect(res.status).toBe("ok");
    const row = await prisma.calendarEvent.findUniqueOrThrow({
      where: { id: personal.id },
    });
    expect(row.title).toBe("Therapy renamed");
  });

  test("non-creator on a non-matter event: events.edit alone is NOT enough", async () => {
    // A personal event created by SOMEONE ELSE. Viewer holds
    // events.edit but not events.edit_non_matter — the action
    // must reject so plain events.edit can't reach into other
    // users' personal calendars.
    const otherUser = await seedUser({
      firmId,
      name: "Other User",
      email: "other@x.com",
    });
    const personal = await prisma.calendarEvent.create({
      data: {
        title: "Personal time",
        type: "personal",
        startTime: new Date("2026-05-01T09:00:00Z"),
        endTime: new Date("2026-05-01T10:00:00Z"),
        createdById: otherUser.userId,
      },
      select: { id: true },
    });
    const { currentUserHasPermission } = await import(
      "@/lib/permission-check"
    );
    const mockedHas = vi.mocked(currentUserHasPermission);
    mockedHas.mockImplementation(async (key: string) =>
      key === "events.edit"
    );
    const res = await updateCalendarEvent(
      personal.id,
      updateCalendarEventInitialState,
      buildEditForm({ title: "Hijacked" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.title?.[0]).toMatch(/permission/i);
    const row = await prisma.calendarEvent.findUniqueOrThrow({
      where: { id: personal.id },
    });
    expect(row.title).toBe("Personal time"); // unchanged
  });

  test("non-creator on a non-matter event: events.edit_non_matter unlocks the edit", async () => {
    const otherUser = await seedUser({
      firmId,
      name: "Other User 2",
      email: "other2@x.com",
    });
    const personal = await prisma.calendarEvent.create({
      data: {
        title: "Personal time",
        type: "personal",
        startTime: new Date("2026-05-01T09:00:00Z"),
        endTime: new Date("2026-05-01T10:00:00Z"),
        createdById: otherUser.userId,
      },
      select: { id: true },
    });
    const { currentUserHasPermission } = await import(
      "@/lib/permission-check"
    );
    const mockedHas = vi.mocked(currentUserHasPermission);
    mockedHas.mockImplementation(async (key: string) =>
      key === "events.edit_non_matter"
    );
    const res = await updateCalendarEvent(
      personal.id,
      updateCalendarEventInitialState,
      buildEditForm({ title: "Approved edit" })
    );
    expect(res.status).toBe("ok");
    const row = await prisma.calendarEvent.findUniqueOrThrow({
      where: { id: personal.id },
    });
    expect(row.title).toBe("Approved edit");
  });

  test("non-creator on a matter event: events.edit gates it (no edit_non_matter needed)", async () => {
    const otherUser = await seedUser({
      firmId,
      name: "Matter Owner",
      email: "mo@x.com",
    });
    const matterEvt = await prisma.calendarEvent.create({
      data: {
        matterId,
        title: "Matter meeting",
        type: "meeting",
        startTime: new Date("2026-05-01T09:00:00Z"),
        endTime: new Date("2026-05-01T10:00:00Z"),
        createdById: otherUser.userId,
      },
      select: { id: true },
    });
    const { currentUserHasPermission } = await import(
      "@/lib/permission-check"
    );
    const mockedHas = vi.mocked(currentUserHasPermission);
    mockedHas.mockImplementation(async (key: string) =>
      key === "events.edit"
    );
    const res = await updateCalendarEvent(
      matterEvt.id,
      updateCalendarEventInitialState,
      buildEditForm({ title: "Updated meeting" })
    );
    expect(res.status).toBe("ok");
    const row = await prisma.calendarEvent.findUniqueOrThrow({
      where: { id: matterEvt.id },
    });
    expect(row.title).toBe("Updated meeting");
  });

  test("non-creator on a matter event without events.edit is rejected", async () => {
    const otherUser = await seedUser({
      firmId,
      name: "Matter Owner 2",
      email: "mo2@x.com",
    });
    const matterEvt = await prisma.calendarEvent.create({
      data: {
        matterId,
        title: "Matter meeting",
        type: "meeting",
        startTime: new Date("2026-05-01T09:00:00Z"),
        endTime: new Date("2026-05-01T10:00:00Z"),
        createdById: otherUser.userId,
      },
      select: { id: true },
    });
    const { currentUserHasPermission } = await import(
      "@/lib/permission-check"
    );
    const mockedHas = vi.mocked(currentUserHasPermission);
    // No perms at all.
    mockedHas.mockResolvedValue(false);
    const res = await updateCalendarEvent(
      matterEvt.id,
      updateCalendarEventInitialState,
      buildEditForm({ title: "Hijacked" })
    );
    expect(res.status).toBe("error");
    expect(res.errors?.title?.[0]).toMatch(/permission/i);
    const row = await prisma.calendarEvent.findUniqueOrThrow({
      where: { id: matterEvt.id },
    });
    expect(row.title).toBe("Matter meeting");
  });
});

// ── deleteCalendarEvent — delete gate ───────────────────────────────────
//
// Mirrors the edit gate with `events.delete` in the permission slot:
//
//   1. Creator bypass — you can always delete your own event.
//   2. Matter event — non-creators need `events.delete`.
//   3. Another user's personal event — needs `events.delete` AND
//      `events.edit_non_matter` (no dedicated delete_non_matter key
//      yet; edit_non_matter is the cross-user personal-calendar grant).
//
// Every test sets the permission mock explicitly — implementations
// persist across tests (no mockReset), same as the edit-gate suite.

describe("deleteCalendarEvent — delete gate", () => {
  const seedPersonalEvent = (createdById: string) =>
    prisma.calendarEvent.create({
      data: {
        title: "Personal thing",
        type: "personal",
        startTime: new Date("2026-05-01T09:00:00Z"),
        endTime: new Date("2026-05-01T10:00:00Z"),
        createdById,
      },
      select: { id: true },
    });

  test("creator can delete their own personal event without any perms", async () => {
    const personal = await seedPersonalEvent(userId);
    const { currentUserHasPermission } = await import(
      "@/lib/permission-check"
    );
    vi.mocked(currentUserHasPermission).mockResolvedValue(false);
    const res = await deleteCalendarEvent(personal.id);
    expect(res.ok).toBe(true);
    expect(
      await prisma.calendarEvent.findUnique({ where: { id: personal.id } })
    ).toBeNull();
  });

  test("non-creator with events.delete can delete a matter event", async () => {
    // Seeded matter event has no createdById → no creator bypass.
    const { currentUserHasPermission } = await import(
      "@/lib/permission-check"
    );
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (key: string) => key === "events.delete"
    );
    const res = await deleteCalendarEvent(eventId);
    expect(res.ok).toBe(true);
    expect(res.matterId).toBe(matterId);
    expect(
      await prisma.calendarEvent.findUnique({ where: { id: eventId } })
    ).toBeNull();
  });

  test("non-creator without events.delete cannot delete a matter event", async () => {
    const { currentUserHasPermission } = await import(
      "@/lib/permission-check"
    );
    vi.mocked(currentUserHasPermission).mockResolvedValue(false);
    const res = await deleteCalendarEvent(eventId);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/permission/i);
    // Hard delete never fired — the row is still there.
    expect(
      await prisma.calendarEvent.findUnique({ where: { id: eventId } })
    ).not.toBeNull();
  });

  test("events.delete alone cannot delete another user's personal event", async () => {
    const other = await seedUser({
      firmId,
      name: "Delete Target",
      email: "deltarget@x.com",
    });
    const personal = await seedPersonalEvent(other.userId);
    const { currentUserHasPermission } = await import(
      "@/lib/permission-check"
    );
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (key: string) => key === "events.delete"
    );
    const res = await deleteCalendarEvent(personal.id);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/permission/i);
    expect(
      await prisma.calendarEvent.findUnique({ where: { id: personal.id } })
    ).not.toBeNull();
  });

  test("events.delete + events.edit_non_matter deletes another user's personal event", async () => {
    const other = await seedUser({
      firmId,
      name: "Delete Target 2",
      email: "deltarget2@x.com",
    });
    const personal = await seedPersonalEvent(other.userId);
    const { currentUserHasPermission } = await import(
      "@/lib/permission-check"
    );
    vi.mocked(currentUserHasPermission).mockImplementation(
      async (key: string) =>
        key === "events.delete" || key === "events.edit_non_matter"
    );
    const res = await deleteCalendarEvent(personal.id);
    expect(res.ok).toBe(true);
    expect(
      await prisma.calendarEvent.findUnique({ where: { id: personal.id } })
    ).toBeNull();
  });

  test("missing event id surfaces a not-found error", async () => {
    const { currentUserHasPermission } = await import(
      "@/lib/permission-check"
    );
    vi.mocked(currentUserHasPermission).mockResolvedValue(true);
    const res = await deleteCalendarEvent("no-such-event");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });
});
