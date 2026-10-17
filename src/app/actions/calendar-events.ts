/**
 * Calendar event server actions — create, update, move, delete.
 *
 * Edit happens inline in the event detail modal on /calendar (the old
 * full-page /calendar/events/[eventId]/edit form is orphaned — nothing
 * links to it, and it posts the legacy attendee shape). Delete fires
 * from the modal footer with a confirm. Move is the calendar's
 * drag-and-drop reschedule (narrow fast-path edit: schedule fields
 * only).
 *
 * ## Time handling (ADR-012)
 *
 * Timed events are real instants. The forms post zone-less
 * `datetime-local` wall-clock strings, which are read in the USER'S
 * profile zone (`parseWallClock(value, getCurrentUserTimeZone())`) —
 * never `new Date(naive)`, which would read them in the server's zone
 * (UTC in production) and store every event hours off. All-day events
 * are date-only values: `YYYY-MM-DD` stored at UTC midnight
 * (`parseDateOnly`), read back with `dateOnlyKey`, no zone applied.
 *
 * ## Authorization model
 *
 * Every mutation that targets an EXISTING event by id (update, move,
 * delete) loads the event first and gates through `canEditEvent` in
 * lib/calendar-visibility.ts — never a blanket permission key alone,
 * which would let a holder of the general grant modify another user's
 * private event they can't even see. The resolver's rules:
 *
 *   1. Creator bypass — you can always edit/move/delete your own
 *      event, no permission keys required.
 *   2. Matter event — non-creators need `events.edit` (`events.delete`
 *      for deletes). Deliberately not scoped to matter-team
 *      membership: matter events are firm business.
 *   3. Another user's personal (non-matter) event — non-creators need
 *      `events.edit_non_matter` (deletes: `events.delete` AND
 *      `events.edit_non_matter`; there's no dedicated
 *      delete_non_matter key yet).
 *
 * Creation (`createCalendarEvent`) has no per-event target, so it
 * gates on `events.create` alone. Any new per-event mutation added to
 * this file must follow the load-then-`canEditEvent` shape above, and
 * resolve the session (`getCurrentUserId`) before the first read.
 *
 * ## Audit
 *
 * Matter events write an ActivityLog row on create / update /
 * reschedule / delete (`logActivity`, type "event"). Personal
 * (matter-less) events are NOT logged: a matter-less row lands in the
 * firm-wide governance feed, which would publish the title of an event
 * its creator kept private.
 */

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma, type Tx } from "@/lib/prisma";
import { getCurrentFirm } from "@/lib/firm";
import { getCurrentUserId } from "@/lib/current-user";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { canEditEvent } from "@/lib/calendar-visibility";
import { getEffectiveCalendarDefaults } from "@/lib/calendar-defaults";
import { logActivity } from "@/lib/activity-log";
import {
  formatDate,
  formatDateOnly,
  parseDateOnly,
  parseWallClock,
} from "@/lib/format-date";
import {
  deleteEventFromGoogle,
  pushEventToGoogle,
} from "@/lib/google/google-calendar-push";
import { EVENT_TYPES } from "@/lib/constants/calendar-event-type";
import {
  currentUserHasPermission,
  requirePermission,
} from "@/lib/permission-check";
import {
  normalizeVideoUrl,
  type CreateCalendarEventState,
  type UpdateCalendarEventFormState,
} from "@/lib/calendar-event-form";

function revalidateForEvent(matterId: string | null): void {
  revalidatePath("/calendar");
  revalidatePath("/"); // dashboard "Today's agenda"
  if (matterId) {
    revalidatePath(`/matters/${matterId}/events`);
    revalidatePath(`/matters/${matterId}`);
  }
}

/** Upper bound on one save's attendee list — keeps the per-attendee
 *  resolution/insert work (one pooled connection) bounded. */
const MAX_ATTENDEES = 100;

// ── Update ──────────────────────────────────────────────────────────────

/** Posted shape for a single attendee. The picker tags each
 *  entry with its source so the action knows whether to link a
 *  user, link a contact, or create a new contact for the
 *  arbitrary case. Name + email are always present (denormalized
 *  snapshot); they're what the chip renders regardless of which
 *  branch the entry came from.
 *
 *  Existing rows posted from the legacy editor (no `kind`) are
 *  treated as `kind: "new"` so the older client form still works
 *  during the rollout. */
const attendeeEntrySchema = z
  .object({
    kind: z
      .enum(["user", "contact", "new"])
      .optional()
      .default("new"),
    /** Set when `kind === "user"`. Server validates against User. */
    userId: z.string().optional().or(z.literal("")),
    /** Set when `kind === "contact"`. Server validates against Contact. */
    contactId: z.string().optional().or(z.literal("")),
    name: z.string().trim().min(1, "Name is required").max(120),
    email: z.string().trim().max(200).optional().or(z.literal("")),
  })
  .superRefine((data, ctx) => {
    // For the new-contact branch, require a parseable email — the
    // arbitrary path mints a real Contact row and a phantom
    // contact with no email is just noise in the directory. The
    // user/contact branches don't need this since the linked row
    // has its own email; we never persist what was typed in those
    // cases (the snapshot uses the linked row's name/email).
    if (data.kind === "new") {
      if (!data.email || data.email.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["email"],
          message: "Email is required when adding a new contact",
        });
      } else {
        const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim());
        if (!ok) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["email"],
            message: "Enter a valid email address",
          });
        }
      }
    }
  });

type AttendeeEntry = z.infer<typeof attendeeEntrySchema>;

// ── Schemas ─────────────────────────────────────────────────────────────

/** Parse the form's startTime / endTime field into a Date.
 *
 *  - Timed events post `YYYY-MM-DDTHH:mm` from `<input type="datetime-local">`.
 *    That is the USER'S wall-clock time — read it in their profile
 *    zone (`tz`), never the server's (`new Date(naive)` would store a
 *    9:00 AM Denver hearing at 09:00Z = 3:00 AM MDT on the UTC host).
 *    Values that already carry `Z` / an offset are taken as-is.
 *  - All-day events post `YYYY-MM-DD` from `<input type="date">`: a
 *    date-only value, stored at UTC midnight (ADR-012), no zone.
 *    Impossible dates (2026-02-30) are rejected, not rolled over.
 *
 *  Returns null when the value can't be parsed (caller surfaces
 *  the field error). */
function parseEventBoundary(
  value: string,
  allDay: boolean,
  tz: string
): Date | null {
  if (allDay) return parseDateOnly(value);
  return parseWallClock(value, tz);
}

/** Cross-field check shared by the create and update schemas:
 *  both boundaries parse and the end isn't before the start. */
function scheduleRefinement(tz: string) {
  return (
    data: { isAllDay?: "on"; startTime: string; endTime: string },
    ctx: z.RefinementCtx
  ): void => {
    const allDay = data.isAllDay === "on";
    const start = parseEventBoundary(data.startTime, allDay, tz);
    const end = parseEventBoundary(data.endTime, allDay, tz);
    if (!start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startTime"],
        message: allDay ? "Invalid start date" : "Invalid start time",
      });
    }
    if (!end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endTime"],
        message: allDay ? "Invalid end date" : "Invalid end time",
      });
    }
    if (start && end && end.getTime() < start.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endTime"],
        message: allDay
          ? "End date must be on or after start date"
          : "End must be after start",
      });
    }
  };
}

/** Optional http(s) video link ("" = none). A bare host gets
 *  https:// prepended in the action body; non-web schemes fail. */
const videoUrlField = z
  .string()
  .max(500)
  .optional()
  .or(z.literal(""))
  .refine(
    (v) => !v || normalizeVideoUrl(v) !== null,
    "Video link must be a web address (https://…)"
  );

const visibilityEnum = z.enum(["default", "show_details"]);

/** Fields common to create and update. */
const eventBaseFields = {
  title: z.string().trim().min(1, "Title is required").max(200),
  isAllDay: z.literal("on").optional(),
  /** Datetime-local "YYYY-MM-DDTHH:mm" for timed events;
   *  date-only "YYYY-MM-DD" for all-day events. */
  startTime: z.string().min(1, "Start time is required"),
  endTime: z.string().min(1, "End time is required"),
  location: z.string().max(200).optional().or(z.literal("")),
  zoomUrl: videoUrlField,
  description: z.string().max(4000).optional().or(z.literal("")),
  /** JSON array of attendee entries (`{ kind, userId, contactId,
   *  name, email }`). */
  attendees: z.string().optional().default("[]"),
};

/** Update schema. `type` and `visibility` are OPTIONAL with no
 *  default: a poster that omits them (the legacy full-page form) must
 *  leave the stored values alone, not reset a show_details event to
 *  private or a hearing to "meeting". */
function makeUpdateEventSchema(tz: string) {
  return z
    .object({
      ...eventBaseFields,
      type: z.enum(EVENT_TYPES).optional(),
      visibility: visibilityEnum.optional(),
    })
    .superRefine(scheduleRefinement(tz));
}

function makeCreateEventSchema(tz: string) {
  return z
    .object({
      ...eventBaseFields,
      type: z.enum(EVENT_TYPES).default("meeting"),
      /** Optional. When omitted / empty the event has no matter
       *  scope — the user's "personal" event in effect. When set,
       *  it's a matter event (visible to the matter team). */
      matterId: z.string().optional().or(z.literal("")),
      /** Per-event visibility override. Defaults to "default"
       *  (resolver decides: creator + attendees + matter team see;
       *  everyone else sees Busy). "show_details" makes this event
       *  firm-wide visible regardless of relationship. */
      visibility: visibilityEnum.optional().default("default"),
    })
    .superRefine(scheduleRefinement(tz));
}

// ── Attendee resolution (shared by create + update) ─────────────────────

/** An attendee entry after its user / contact link was validated against
 *  live rows. `name` / `email` are the snapshot to persist: the LINKED
 *  row's for kind user / contact (never what the client typed — a
 *  crafted payload could otherwise label partner X's row as
 *  "Opposing Counsel <x@evil.com>"), the typed values for kind new. */
type ResolvedAttendee = {
  kind: "user" | "contact" | "new";
  userId: string | null;
  contactId: string | null;
  name: string;
  email: string | null;
  /** False for a linked user who has since been deactivated (only
   *  possible for a user already attending the event being edited). */
  active: boolean;
};

type AttendeeResolution =
  | { ok: true; resolved: ResolvedAttendee[]; firmId: string | null }
  | { ok: false; error: string };

/** Parse + resolve an attendees JSON payload BEFORE any write, so a bad
 *  payload never half-updates an event and a stale id fails the save
 *  with a field error (never an attendee row with both FKs null, never
 *  a Contact minted from a non-"new" entry that skipped the email
 *  checks).
 *
 *  `existing` lists the user / contact ids ALREADY attending the event
 *  being edited: those may stay even though the person was deactivated
 *  since (re-posting an old attendee list must not block every later
 *  save — and deleting them would destroy the attendance record). New
 *  picks must still be active. Pass nothing on create.
 *
 *  Lookups are batched (one query per kind), and the list is capped at
 *  MAX_ATTENDEES. Duplicate-email pre-flight for kind=new mirrors the
 *  directory rule: in-list duplicates first, then the firm-scoped
 *  existing-contact check. */
async function resolveAttendees(
  attendeesJson: string,
  existing: {
    userIds: ReadonlySet<string>;
    contactIds: ReadonlySet<string>;
  } = { userIds: new Set(), contactIds: new Set() }
): Promise<AttendeeResolution> {
  const attendeeList: AttendeeEntry[] = [];
  try {
    const decoded: unknown = JSON.parse(attendeesJson);
    if (!Array.isArray(decoded)) throw new Error("not an array");
    if (decoded.length > MAX_ATTENDEES) {
      return {
        ok: false,
        error: `An event can have at most ${MAX_ATTENDEES} attendees.`,
      };
    }
    for (const raw of decoded) {
      const r = attendeeEntrySchema.safeParse(raw);
      if (!r.success) {
        return {
          ok: false,
          error: r.error.issues[0]?.message ?? "Invalid attendee",
        };
      }
      attendeeList.push(r.data);
    }
  } catch {
    return { ok: false, error: "Attendee list was malformed — try again." };
  }

  const userIds = [
    ...new Set(
      attendeeList.flatMap((a) =>
        a.kind === "user" && a.userId ? [a.userId] : []
      )
    ),
  ];
  const contactIds = [
    ...new Set(
      attendeeList.flatMap((a) =>
        a.kind === "contact" && a.contactId ? [a.contactId] : []
      )
    ),
  ];
  const [users, contacts] = await Promise.all([
    userIds.length > 0
      ? prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true, isActive: true },
        })
      : Promise.resolve([]),
    contactIds.length > 0
      ? prisma.contact.findMany({
          where: { id: { in: contactIds } },
          select: { id: true, name: true, email: true, isActive: true },
        })
      : Promise.resolve([]),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const contactById = new Map(contacts.map((c) => [c.id, c]));

  const resolved: ResolvedAttendee[] = [];
  for (const a of attendeeList) {
    if (a.kind === "user") {
      const u = a.userId ? userById.get(a.userId) : undefined;
      if (!u || (!u.isActive && !existing.userIds.has(u.id))) {
        return {
          ok: false,
          error: `"${a.name}" is no longer an active firm user — remove them and pick again.`,
        };
      }
      resolved.push({
        kind: "user",
        userId: u.id,
        contactId: null,
        name: u.name,
        email: u.email,
        active: u.isActive,
      });
    } else if (a.kind === "contact") {
      const c = a.contactId ? contactById.get(a.contactId) : undefined;
      if (!c || (!c.isActive && !existing.contactIds.has(c.id))) {
        return {
          ok: false,
          error: `"${a.name}" no longer matches an active contact — remove them and pick again.`,
        };
      }
      resolved.push({
        kind: "contact",
        userId: null,
        contactId: c.id,
        name: c.name,
        email: c.email,
        active: c.isActive,
      });
    } else {
      // kind === "new" — the Contact row is minted inside the
      // write transaction so a failed save never leaves a
      // half-created directory entry behind.
      resolved.push({
        kind: "new",
        userId: null,
        contactId: null,
        name: a.name.trim(),
        email: a.email?.trim() || null,
        active: true,
      });
    }
  }

  // Duplicate-email pre-flight for new-contact entries.
  const newEmails = resolved
    .filter((r) => r.kind === "new")
    .map((r) => (r.email ?? "").toLowerCase())
    .filter((e) => e.length > 0);
  const seen = new Set<string>();
  for (const e of newEmails) {
    if (seen.has(e)) {
      return {
        ok: false,
        error: `Two new attendees share the email "${e}" — pick one or merge.`,
      };
    }
    seen.add(e);
  }

  // Resolve the firm only when a new-contact entry needs it: the
  // dup check scopes to it and the minted Contact is stamped with it.
  const needsFirm = resolved.some((r) => r.kind === "new");
  const firm = needsFirm ? await getCurrentFirm() : null;
  if (firm && newEmails.length > 0) {
    // Firm-scoped uniqueness check, bounded by the new-attendee
    // emails (`email: { in: ... }`) — never the whole Contact
    // table. Postgres backs `mode: "insensitive"`; the Map below
    // only re-lowercases the returned handful of rows to pair each
    // collision with the existing contact's name for the message.
    // The OR-firmId-null branch matches legacy unbackfilled rows —
    // drop that clause once Contact.firmId is required.
    const existingContacts = await prisma.contact.findMany({
      where: {
        isActive: true,
        email: { in: newEmails, mode: "insensitive" },
        OR: [{ firmId: firm.id }, { firmId: null }],
      },
      select: { email: true, name: true },
    });
    const existingByEmail = new Map<string, string>(
      existingContacts
        .filter((c) => c.email)
        .map((c) => [c.email!.toLowerCase(), c.name])
    );
    const collision = newEmails.find((e) => existingByEmail.has(e));
    if (collision) {
      return {
        ok: false,
        error: `A contact with email "${collision}" already exists (${existingByEmail.get(collision)}). Pick them from the list instead of creating a duplicate.`,
      };
    }
  }

  return { ok: true, resolved, firmId: firm?.id ?? null };
}

/** Write one resolved attendee inside a transaction. Firm-user rows
 *  are implicitly attending (`accepted`); external rows (contact pick
 *  or newly minted contact) stay `pending` until a real RSVP flow
 *  lands. kind=new mints a Contact (type=other, firm-stamped) here so
 *  a failed save never strands a directory row. */
async function writeAttendee(
  tx: Tx,
  eventId: string,
  r: ResolvedAttendee,
  firmId: string | null
): Promise<void> {
  let contactId = r.contactId;
  if (r.kind === "new") {
    const created = await tx.contact.create({
      data: { firmId, name: r.name, email: r.email, type: "other" },
      select: { id: true },
    });
    contactId = created.id;
  }
  await tx.calendarAttendee.create({
    data: {
      eventId,
      userId: r.userId,
      contactId,
      // Snapshot the display name + email so renaming a
      // user/contact later won't silently rewrite past attendance.
      name: r.name,
      email: r.email,
      status: r.userId ? "accepted" : "pending",
    },
  });
}

/** "Jun 10, 2026, 9:00 AM" for a timed bound, "Jun 10, 2026" for an
 *  all-day one — the old → new text in schedule-change audit rows. */
function describeBoundary(d: Date, allDay: boolean, tz: string): string {
  return allDay
    ? formatDateOnly(d, "medium")
    : formatDate(d, "datetime_medium", tz);
}

/** Audit detail for an edit that moved the event. */
function describeReschedule(
  title: string,
  from: { start: Date; isAllDay: boolean },
  to: { start: Date; isAllDay: boolean },
  tz: string
): string {
  return `${title} · ${describeBoundary(from.start, from.isAllDay, tz)} → ${describeBoundary(to.start, to.isAllDay, tz)}`;
}

// ── Update ──────────────────────────────────────────────────────────────

export async function updateCalendarEvent(
  eventId: string,
  _prev: UpdateCalendarEventFormState,
  formData: FormData
): Promise<UpdateCalendarEventFormState> {
  // Session + zone first: nothing is read from the database before
  // the caller is known, and the schema needs the zone to read the
  // posted wall-clock times.
  const viewerId = await getCurrentUserId();
  const tz = await getCurrentUserTimeZone();

  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = makeUpdateEventSchema(tz).safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const event = await prisma.calendarEvent.findUnique({
    where: { id: eventId },
    select: {
      matterId: true,
      createdById: true,
      title: true,
      startTime: true,
      endTime: true,
      isAllDay: true,
      attendees: { select: { userId: true, contactId: true } },
      matter: {
        select: {
          teamMembers: {
            where: { removedAt: null },
            select: { userId: true },
          },
        },
      },
    },
  });
  if (!event) {
    return {
      status: "error",
      errors: { title: ["Event no longer exists"] },
    };
  }

  // Edit gate per the visibility model. Creator bypass first
  // (you can always edit your own events regardless of perms);
  // otherwise events.edit gates matter events, and
  // events.edit_non_matter gates other users' personal events.
  // The resolver lives in lib/calendar-visibility.ts so the
  // modal's canEdit prop and this server check can use the
  // same logic.
  const [hasEventsEdit, hasEventsEditNonMatter] = await Promise.all([
    currentUserHasPermission("events.edit"),
    currentUserHasPermission("events.edit_non_matter"),
  ]);
  const allowed = canEditEvent({
    viewerId,
    createdById: event.createdById,
    matterId: event.matterId,
    matterTeamUserIds:
      event.matter?.teamMembers.map((m) => m.userId) ?? [],
    perms: { hasEventsEdit, hasEventsEditNonMatter },
  });
  if (!allowed) {
    return {
      status: "error",
      errors: {
        title: ["You don't have permission to edit this event."],
      },
    };
  }

  // Parse + resolve the attendees list before opening the
  // transaction so a malformed payload doesn't half-update the
  // event's core fields. People already on this event may remain
  // even if deactivated since.
  const resolution = await resolveAttendees(parsed.data.attendees, {
    userIds: new Set(
      event.attendees.flatMap((a) => (a.userId ? [a.userId] : []))
    ),
    contactIds: new Set(
      event.attendees.flatMap((a) => (a.contactId ? [a.contactId] : []))
    ),
  });
  if (!resolution.ok) {
    return { status: "error", errors: { attendees: [resolution.error] } };
  }
  const resolvedAttendees = resolution.resolved;

  // Min-firm-attendee invariant: every event must keep at least
  // one ACTIVE firm user attached. Stops a user from accidentally
  // orphaning an event (no one to surface it on a calendar, no
  // one to follow up). External contacts/arbitrary names don't
  // satisfy the rule, and neither does a deactivated user who is
  // merely still on the list.
  //
  // Exception: an event that has NO attendee rows at all (a Google
  // Calendar import creates them that way) would otherwise reject
  // every edit until the user manually added themselves — adopt the
  // editor as its first attendee instead. An event that HAD
  // attendees and had them all removed still errors.
  const firmAttendeeCount = resolvedAttendees.filter(
    (r) => r.userId !== null && r.active
  ).length;
  if (firmAttendeeCount === 0) {
    const viewer =
      event.attendees.length === 0
        ? await prisma.user.findUnique({
            where: { id: viewerId },
            select: { id: true, name: true, email: true, isActive: true },
          })
        : null;
    if (viewer?.isActive) {
      resolvedAttendees.push({
        kind: "user",
        userId: viewer.id,
        contactId: null,
        name: viewer.name,
        email: viewer.email,
        active: true,
      });
    } else {
      return {
        status: "error",
        errors: {
          attendees: [
            "Every event needs at least one firm attendee. Add yourself or another team member before saving.",
          ],
        },
      };
    }
  }

  const allDay = parsed.data.isAllDay === "on";
  // Re-parse here — the superRefine validated shape, but didn't
  // hand us the parsed Date. Both calls succeed at this point
  // because the schema would have errored otherwise.
  const startDate = parseEventBoundary(parsed.data.startTime, allDay, tz)!;
  const endDate = parseEventBoundary(parsed.data.endTime, allDay, tz)!;

  await prisma.$transaction(async (tx) => {
    await tx.calendarEvent.update({
      where: { id: eventId },
      data: {
        title: parsed.data.title,
        // Only written when posted — see makeUpdateEventSchema.
        ...(parsed.data.type !== undefined ? { type: parsed.data.type } : {}),
        isAllDay: allDay,
        startTime: startDate,
        endTime: endDate,
        location: parsed.data.location || null,
        zoomUrl: normalizeVideoUrl(parsed.data.zoomUrl ?? "") || null,
        description: parsed.data.description || null,
        ...(parsed.data.visibility !== undefined
          ? { visibility: parsed.data.visibility }
          : {}),
      },
    });
    // Replace-all attendees — simpler than a diff at this scale,
    // and existing rows had no per-attendee state worth preserving
    // (status defaults to "pending" today; RSVP isn't wired yet).
    await tx.calendarAttendee.deleteMany({ where: { eventId } });
    for (const r of resolvedAttendees) {
      await writeAttendee(tx, eventId, r, resolution.firmId);
    }
  });

  // Google Calendar push — AFTER the local commit (local state is
  // the user's intent). Never rejects: token-less/unscoped
  // creators skip silently, failures warn and leave the CRM save
  // intact. See src/lib/google/google-calendar-push.ts.
  await pushEventToGoogle(eventId);

  if (event.matterId) {
    const moved =
      event.isAllDay !== allDay ||
      event.startTime.getTime() !== startDate.getTime() ||
      event.endTime.getTime() !== endDate.getTime();
    await logActivity({
      matterId: event.matterId,
      userId: viewerId,
      type: "event",
      title: moved ? "Event rescheduled" : "Event updated",
      detail: moved
        ? describeReschedule(
            parsed.data.title,
            { start: event.startTime, isAllDay: event.isAllDay },
            { start: startDate, isAllDay: allDay },
            tz
          )
        : parsed.data.title,
    });
  }

  revalidateForEvent(event.matterId);
  return { status: "ok" };
}

// ── Delete ──────────────────────────────────────────────────────────────

export async function deleteCalendarEvent(
  eventId: string
): Promise<{ ok: boolean; error?: string; matterId: string | null }> {
  // Session before the first read (see the header).
  const viewerId = await getCurrentUserId();
  const event = await prisma.calendarEvent.findUnique({
    where: { id: eventId },
    select: {
      matterId: true,
      createdById: true,
      title: true,
      matter: {
        select: {
          teamMembers: {
            where: { removedAt: null },
            select: { userId: true },
          },
        },
      },
    },
  });
  if (!event) return { ok: false, error: "Event not found", matterId: null };

  // Delete gate mirrors the edit gate (canEditEvent) with
  // `events.delete` slotted into the permission branch: creator
  // bypass first (you can always delete your own event), then the
  // granular key for matter events. Deleting ANOTHER user's
  // personal event additionally requires `events.edit_non_matter`
  // — there's no dedicated events.delete_non_matter key yet, and
  // edit_non_matter is the existing "may reach into other users'
  // personal calendars" grant, so events.delete alone must not
  // erase someone's private event.
  const [hasEventsDelete, hasEventsEditNonMatter] = await Promise.all([
    currentUserHasPermission("events.delete"),
    currentUserHasPermission("events.edit_non_matter"),
  ]);
  const allowed = canEditEvent({
    viewerId,
    createdById: event.createdById,
    matterId: event.matterId,
    matterTeamUserIds:
      event.matter?.teamMembers.map((m) => m.userId) ?? [],
    perms: {
      hasEventsEdit: hasEventsDelete,
      hasEventsEditNonMatter: hasEventsDelete && hasEventsEditNonMatter,
    },
  });
  if (!allowed) {
    return {
      ok: false,
      error: "You don't have permission to delete this event.",
      matterId: null,
    };
  }

  // Google Calendar delete — BEFORE the CRM row goes: the
  // CalendarEventSync mappings cascade away with the event, and
  // this is the last moment they're readable. Never rejects, so a
  // Google failure can't block the CRM delete — the trade-off
  // (documented in google-calendar-push.ts) is that a transient
  // failure orphans the Google copy until the user removes it
  // manually there. Accepted for v1.
  await deleteEventFromGoogle(eventId);

  await prisma.calendarEvent.delete({ where: { id: eventId } });

  if (event.matterId) {
    await logActivity({
      matterId: event.matterId,
      userId: viewerId,
      type: "event",
      title: "Event deleted",
      detail: event.title,
    });
  }

  revalidateForEvent(event.matterId);
  return { ok: true, matterId: event.matterId };
}

/**
 * Delete-and-redirect helper — after the event is gone, send the user
 * to the calendar (or back to the matter's events tab if there was
 * one). A refused or failed delete RETURNS `{ ok: false, error }` for
 * the caller to show; success redirects (and never returns).
 *
 * The event modal should prefer `deleteCalendarEvent` + closing itself:
 * this redirect drops the calendar's `?view=` / `?d=` state.
 */
export async function deleteCalendarEventAndRedirect(
  eventId: string
): Promise<{ ok: false; error: string } | void> {
  const result = await deleteCalendarEvent(eventId);
  if (!result.ok) {
    return { ok: false, error: result.error ?? "Couldn't delete the event." };
  }
  if (result.matterId) {
    redirect(`/matters/${result.matterId}/events`);
  }
  redirect("/calendar");
}

// ── Standalone create (calendar page's "+ New event") ─────────────────

/**
 * Create a calendar event from the standalone calendar page.
 * `matterId` is optional — without one the event is on the
 * user's personal calendar (no matter scope). Doesn't go
 * through `createEventWithCaptures` because the calendar page's
 * composer doesn't surface attached siblings; the matter-detail
 * page still uses that richer flow.
 *
 * Attendees can be posted at create time (the full-page form's
 * picker); the quick composer omits the field. Either way the
 * creator is guaranteed onto the event as a firm attendee — the
 * min-firm-attendee invariant holds from birth, and unlike the
 * update path an external-only list isn't an error here: we just
 * add the creator alongside it. On a matter event, the matter team
 * is added too when the effective `autoAddTeamToNewEvents` setting
 * (matter override → firm default) is on — same as the matter
 * Events tab's composer.
 *
 * Auth: gated on `events.create`. Same key for matter and
 * personal events — the gate is "can this user create calendar
 * events at all."
 */
export async function createCalendarEvent(
  _prev: CreateCalendarEventState,
  formData: FormData
): Promise<CreateCalendarEventState> {
  await requirePermission("events.create");
  const createdById = await getCurrentUserId();
  const tz = await getCurrentUserTimeZone();
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = makeCreateEventSchema(tz).safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
    };
  }
  const allDay = parsed.data.isAllDay === "on";
  const startDate = parseEventBoundary(parsed.data.startTime, allDay, tz)!;
  const endDate = parseEventBoundary(parsed.data.endTime, allDay, tz)!;
  const matterId =
    parsed.data.matterId && parsed.data.matterId.length > 0
      ? parsed.data.matterId
      : null;

  // A matter must exist and not be archived — a stale or forged id
  // would otherwise hit the FK inside the transaction and surface as
  // a 500 instead of a field error.
  if (matterId) {
    const matter = await prisma.matter.findUnique({
      where: { id: matterId },
      select: { isArchived: true },
    });
    if (!matter || matter.isArchived) {
      return {
        status: "error",
        errors: { matterId: ["Pick an open matter for this event."] },
      };
    }
  }

  // Parse + resolve posted attendees (full-page form). Rejections
  // happen before any write so a bad payload never half-creates.
  const attendeeResolution = await resolveAttendees(parsed.data.attendees);
  if (!attendeeResolution.ok) {
    return {
      status: "error",
      errors: { attendees: [attendeeResolution.error] },
    };
  }
  const resolvedAttendees = attendeeResolution.resolved;

  // Effective auto-add setting, resolved BEFORE the transaction so
  // the team query is skipped entirely when it's off.
  const autoAddTeam = matterId
    ? (await getEffectiveCalendarDefaults(matterId)).autoAddTeamToNewEvents
    : false;

  // Wrap the create + attendee inserts in a transaction so the
  // min-firm-attendee invariant holds atomically — the event
  // never exists without at least one firm attendee.
  const created = await prisma.$transaction(async (tx) => {
    const ev = await tx.calendarEvent.create({
      data: {
        matterId,
        createdById,
        title: parsed.data.title,
        type: parsed.data.type,
        isAllDay: allDay,
        startTime: startDate,
        endTime: endDate,
        location: parsed.data.location || null,
        zoomUrl: normalizeVideoUrl(parsed.data.zoomUrl ?? "") || null,
        description: parsed.data.description || null,
        visibility: parsed.data.visibility,
      },
      select: { id: true },
    });

    // Firm users already attending, so neither the team add nor the
    // creator fallback double-rows anyone the picker already posted.
    const attending = new Set(
      resolvedAttendees.flatMap((r) => (r.userId ? [r.userId] : []))
    );

    // Matter team (active members of active accounts) when the
    // effective setting is on — accepted, snapshotted like every
    // other firm-user attendee.
    if (autoAddTeam && matterId) {
      const team = await tx.matterTeamMember.findMany({
        where: { matterId, removedAt: null, user: { isActive: true } },
        select: { user: { select: { id: true, name: true, email: true } } },
      });
      const toAdd = new Map<string, { name: string; email: string }>();
      for (const t of team) {
        if (!attending.has(t.user.id) && !toAdd.has(t.user.id)) {
          toAdd.set(t.user.id, { name: t.user.name, email: t.user.email });
        }
      }
      if (toAdd.size > 0) {
        await tx.calendarAttendee.createMany({
          data: [...toAdd].map(([userId, u]) => ({
            eventId: ev.id,
            userId,
            name: u.name,
            email: u.email,
            status: "accepted",
          })),
        });
        for (const id of toAdd.keys()) attending.add(id);
      }
    }

    // Auto-add the creator as a firm-user attendee — unless already
    // attending (posted explicitly, or on the matter team). Snapshot
    // their name + email so a future rename doesn't rewrite the
    // attendee label. Status `accepted` (creator is implicitly
    // attending — RSVP doesn't apply to "you scheduled this").
    if (!attending.has(createdById)) {
      const creator = await tx.user.findUniqueOrThrow({
        where: { id: createdById },
        select: { name: true, email: true },
      });
      await tx.calendarAttendee.create({
        data: {
          eventId: ev.id,
          userId: createdById,
          name: creator.name,
          email: creator.email,
          status: "accepted",
        },
      });
    }

    // Posted attendee rows — same branch semantics as the update path.
    for (const r of resolvedAttendees) {
      await writeAttendee(tx, ev.id, r, attendeeResolution.firmId);
    }
    return ev;
  });

  // Google Calendar push — after the local commit. Covers BOTH
  // create paths (the quick composer and the full-page form post
  // through this action). Never rejects; see
  // src/lib/google/google-calendar-push.ts.
  await pushEventToGoogle(created.id);

  if (matterId) {
    await logActivity({
      matterId,
      userId: createdById,
      type: "event",
      title: "Event scheduled",
      detail: parsed.data.title,
    });
  }

  // Calendar refreshes via revalidate so the newly-created
  // event shows up on the next render.
  revalidateForEvent(matterId);
  return { status: "ok", eventId: created.id };
}

// ── Move (drag-and-drop) ───────────────────────────────────────────────
//
// Reschedule action used by the calendar's drag-and-drop. Compared to
// `updateCalendarEvent` this is a narrow, fast-path mutation: only the
// schedule fields change, no attendees / description / type touched.
// The client sends ISO strings + the all-day flag; the server
// re-validates the boundary semantics (end >= start; non-empty;
// parseable) before writing.
//
// Auth: same `canEditEvent` resolver as `updateCalendarEvent` — a drag
// is just a narrower edit, so it must not leak capabilities the form
// path denies (`events.edit` alone doesn't reschedule another user's
// personal event) nor deny ones it grants (creator bypass).
//
// Time handling: timed bounds are instants (ISO with a zone; a
// zone-less value is the user's wall clock). All-day bounds are
// date-only values: `YYYY-MM-DD`, or an instant whose UTC calendar
// date is the intended day (UTC midnight, noon UTC, a western
// local-midnight) — stored at UTC midnight either way.

const NAIVE_DATE_PREFIX_RE = /^(\d{4}-\d{2}-\d{2})(?:T[\d:.]*)?$/;

/** Parse one drag boundary. Null when unparseable. */
function parseMoveBoundary(
  value: string,
  allDay: boolean,
  tz: string
): Date | null {
  if (!allDay) return parseWallClock(value, tz);
  const naive = NAIVE_DATE_PREFIX_RE.exec(value);
  if (naive) return parseDateOnly(naive[1]!);
  // Explicit-zone instant (…Z / ±hh:mm): its UTC calendar date is the day.
  const instant = parseWallClock(value, tz);
  if (!instant) return null;
  return new Date(
    Date.UTC(
      instant.getUTCFullYear(),
      instant.getUTCMonth(),
      instant.getUTCDate()
    )
  );
}

function makeMoveSchema(tz: string) {
  return z
    .object({
      isAllDay: z.boolean(),
      /** ISO 8601 strings — the client builds them from a Date and
       *  POSTs as JSON via the action. We re-parse + revalidate here. */
      startTime: z.string().min(1),
      endTime: z.string().min(1),
    })
    .superRefine((data, ctx) => {
      const start = parseMoveBoundary(data.startTime, data.isAllDay, tz);
      const end = parseMoveBoundary(data.endTime, data.isAllDay, tz);
      if (!start) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["startTime"],
          message: "Invalid start",
        });
      }
      if (!end) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["endTime"],
          message: "Invalid end",
        });
      }
      if (start && end && end.getTime() < start.getTime()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["endTime"],
          message: "End must be on or after start",
        });
      }
    });
}

export async function moveCalendarEvent(
  eventId: string,
  input: { isAllDay: boolean; startTime: string; endTime: string }
): Promise<{ ok: boolean; error?: string }> {
  const viewerId = await getCurrentUserId();
  const tz = await getCurrentUserTimeZone();
  const parsed = makeMoveSchema(tz).safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Invalid move." };
  }

  const event = await prisma.calendarEvent.findUnique({
    where: { id: eventId },
    select: {
      matterId: true,
      createdById: true,
      title: true,
      isAllDay: true,
      startTime: true,
      endTime: true,
      matter: {
        select: {
          teamMembers: {
            where: { removedAt: null },
            select: { userId: true },
          },
        },
      },
    },
  });
  if (!event) {
    return { ok: false, error: "Event not found." };
  }

  // Same edit gate as updateCalendarEvent (see the header comment
  // above) — a blanket requirePermission("events.edit") here would
  // both over-grant (edit-holders dragging other users' personal
  // events) and under-grant (creators without events.edit blocked
  // from dragging their own).
  const [hasEventsEdit, hasEventsEditNonMatter] = await Promise.all([
    currentUserHasPermission("events.edit"),
    currentUserHasPermission("events.edit_non_matter"),
  ]);
  const allowed = canEditEvent({
    viewerId,
    createdById: event.createdById,
    matterId: event.matterId,
    matterTeamUserIds:
      event.matter?.teamMembers.map((m) => m.userId) ?? [],
    perms: { hasEventsEdit, hasEventsEditNonMatter },
  });
  if (!allowed) {
    return {
      ok: false,
      error: "You don't have permission to move this event.",
    };
  }

  const isAllDay = parsed.data.isAllDay;
  const newStart = parseMoveBoundary(parsed.data.startTime, isAllDay, tz)!;
  let newEnd = parseMoveBoundary(parsed.data.endTime, isAllDay, tz)!;

  // The week view's all-day drop posts a single day (start = end).
  // Moving an already multi-day all-day event must keep its length,
  // not silently truncate it to one day (and push that to Google).
  if (
    isAllDay &&
    event.isAllDay &&
    newEnd.getTime() === newStart.getTime() &&
    event.endTime.getTime() > event.startTime.getTime()
  ) {
    newEnd = new Date(
      newStart.getTime() + (event.endTime.getTime() - event.startTime.getTime())
    );
  }

  await prisma.calendarEvent.update({
    where: { id: eventId },
    data: { isAllDay, startTime: newStart, endTime: newEnd },
  });

  // Google Calendar push — a drag is an edit; the reschedule flows
  // out the same way. Never rejects.
  await pushEventToGoogle(eventId);

  if (event.matterId) {
    await logActivity({
      matterId: event.matterId,
      userId: viewerId,
      type: "event",
      title: "Event rescheduled",
      detail: describeReschedule(
        event.title,
        { start: event.startTime, isAllDay: event.isAllDay },
        { start: newStart, isAllDay },
        tz
      ),
    });
  }

  revalidateForEvent(event.matterId);
  return { ok: true };
}
