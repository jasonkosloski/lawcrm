/**
 * Calendar event server actions — create, update, move, delete.
 *
 * Edit lives at /calendar/events/[eventId]/edit (linked from the event
 * detail modal). Delete fires from the modal footer with a confirm.
 * Move is the calendar's drag-and-drop reschedule (narrow fast-path
 * edit: schedule fields only).
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
 * this file must follow the load-then-`canEditEvent` shape above.
 */

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentFirm } from "@/lib/firm";
import { getCurrentUserId } from "@/lib/current-user";
import { canEditEvent } from "@/lib/calendar-visibility";
import { EVENT_TYPES } from "@/lib/note-constants";
import {
  currentUserHasPermission,
  requirePermission,
} from "@/lib/permission-check";
import type {
  CreateCalendarEventState,
  UpdateCalendarEventFormState,
} from "@/lib/calendar-event-form";

function revalidateForEvent(matterId: string | null): void {
  revalidatePath("/calendar");
  revalidatePath("/"); // dashboard "Today's agenda"
  if (matterId) {
    revalidatePath(`/matters/${matterId}/events`);
    revalidatePath(`/matters/${matterId}`);
  }
}

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

const updateEventSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(200),
    type: z.enum(EVENT_TYPES).default("meeting"),
    isAllDay: z.literal("on").optional(),
    /** Datetime-local "YYYY-MM-DDTHH:mm" for timed events;
     *  date-only "YYYY-MM-DD" for all-day events. The
     *  superRefine + the action body below normalize both
     *  shapes into proper Date objects. */
    startTime: z.string().min(1, "Start time is required"),
    endTime: z.string().min(1, "End time is required"),
    location: z.string().max(200).optional().or(z.literal("")),
    zoomUrl: z.string().max(500).optional().or(z.literal("")),
    description: z.string().max(4000).optional().or(z.literal("")),
    /** JSON array of `{ name, email }` from the form's hidden
     *  field. Replace-all on save. Optional / empty = no
     *  attendees. */
    attendees: z.string().optional().default("[]"),
    /** Per-event visibility override. Defaults to "default"
     *  (resolver applies standard rules). "show_details" makes
     *  the event publicly visible in full. */
    visibility: z
      .enum(["default", "show_details"])
      .optional()
      .default("default"),
  })
  .superRefine((data, ctx) => {
    const allDay = data.isAllDay === "on";
    const start = parseEventBoundary(data.startTime, allDay);
    const end = parseEventBoundary(data.endTime, allDay);
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
        message: allDay ? "End date must be on or after start date" : "End must be after start",
      });
    }
  });

/** Parse the form's startTime / endTime field into a Date.
 *
 *  - Timed events post `YYYY-MM-DDTHH:mm` from `<input type="datetime-local">`.
 *    Pass through `new Date(...)` which interprets the value as
 *    local time.
 *  - All-day events post `YYYY-MM-DD` from `<input type="date">`.
 *    Build the Date as local midnight of that day. We don't use
 *    `new Date(value)` directly because that parses ISO date-only
 *    as UTC, which would shift the day for any user west of UTC.
 *
 *  Returns null when the value can't be parsed (caller surfaces
 *  the field error). */
function parseEventBoundary(value: string, allDay: boolean): Date | null {
  if (allDay) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!m) return null;
    const [, y, mo, d] = m;
    const date = new Date(Number(y), Number(mo) - 1, Number(d), 0, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function updateCalendarEvent(
  eventId: string,
  _prev: UpdateCalendarEventFormState,
  formData: FormData
): Promise<UpdateCalendarEventFormState> {
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = updateEventSchema.safeParse(raw);
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
  const viewerId = await getCurrentUserId();
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

  // Parse + validate the attendees list before opening the
  // transaction so a malformed payload doesn't half-update the
  // event's core fields.
  let attendeeList: AttendeeEntry[] = [];
  try {
    const decoded = JSON.parse(parsed.data.attendees);
    if (!Array.isArray(decoded)) throw new Error("not an array");
    for (const raw of decoded) {
      const r = attendeeEntrySchema.safeParse(raw);
      if (!r.success) {
        return {
          status: "error",
          errors: { attendees: [r.error.issues[0]?.message ?? "Invalid attendee"] },
        };
      }
      attendeeList.push(r.data);
    }
  } catch {
    return {
      status: "error",
      errors: { attendees: ["Attendee list was malformed — try again."] },
    };
  }

  // Resolve linked user/contact entries BEFORE opening the
  // transaction. Two reasons: (a) a missing/empty/stale id must
  // fail the save with a field error — never silently write an
  // attendee row with BOTH FKs null, and never let a non-"new"
  // entry fall into the create-a-Contact branch (those entries
  // skipped the email-required superRefine and the duplicate-email
  // pre-check, so minting a Contact from them can create email-less
  // or duplicate directory rows); (b) the min-firm-attendee check
  // below has to count users that actually resolved — a deactivated
  // user in a stale payload must not satisfy the invariant.
  type ResolvedAttendee = {
    entry: AttendeeEntry;
    userId: string | null;
    contactId: string | null;
  };
  const resolvedAttendees: ResolvedAttendee[] = [];
  for (const a of attendeeList) {
    if (a.kind === "user") {
      const u = a.userId
        ? await prisma.user.findUnique({
            where: { id: a.userId },
            select: { id: true, isActive: true },
          })
        : null;
      if (!u?.isActive) {
        return {
          status: "error",
          errors: {
            attendees: [
              `"${a.name}" is no longer an active firm user — remove them and pick again.`,
            ],
          },
        };
      }
      resolvedAttendees.push({ entry: a, userId: u.id, contactId: null });
    } else if (a.kind === "contact") {
      const c = a.contactId
        ? await prisma.contact.findUnique({
            where: { id: a.contactId },
            select: { id: true, isActive: true },
          })
        : null;
      if (!c?.isActive) {
        return {
          status: "error",
          errors: {
            attendees: [
              `"${a.name}" no longer matches an active contact — remove them and pick again.`,
            ],
          },
        };
      }
      resolvedAttendees.push({ entry: a, userId: null, contactId: c.id });
    } else {
      // kind === "new" — the Contact row is minted inside the
      // transaction below so a failed save never leaves a
      // half-created directory entry behind.
      resolvedAttendees.push({ entry: a, userId: null, contactId: null });
    }
  }

  // Min-firm-attendee invariant: every event must keep at least
  // one firm user attached. Stops a user from accidentally
  // orphaning an event (no one to surface it on a calendar, no
  // one to follow up). Counts RESOLVED kind=user entries —
  // external contacts/arbitrary names don't satisfy the rule
  // because they aren't firm members, and the resolution above
  // already rejected any user entry that didn't land on an
  // active User row.
  const firmAttendeeCount = resolvedAttendees.filter(
    (r) => r.userId !== null
  ).length;
  if (firmAttendeeCount === 0) {
    return {
      status: "error",
      errors: {
        attendees: [
          "Every event needs at least one firm attendee. Add yourself or another team member before saving.",
        ],
      },
    };
  }

  // Resolve the current firm once — used by the new-contact
  // branch to scope the duplicate-email check + stamp firmId on
  // any newly-created Contact rows. We also pre-flight any
  // duplicate emails BEFORE opening the transaction so we can
  // return a clean error without doing partial work.
  const firm = await getCurrentFirm();
  const newAttendees = attendeeList.filter((a) => a.kind === "new");
  if (newAttendees.length > 0) {
    // Lowercased emails for the dup check — Contact.email is
    // free-form so we normalize on read.
    const newEmails = newAttendees
      .map((a) => a.email!.trim().toLowerCase())
      .filter((e) => e.length > 0);
    // Check for in-list duplicates first (two new entries with
    // the same email in the same save).
    const seen = new Set<string>();
    for (const e of newEmails) {
      if (seen.has(e)) {
        return {
          status: "error",
          errors: {
            attendees: [
              `Two new attendees share the email "${e}" — pick one or merge.`,
            ],
          },
        };
      }
      seen.add(e);
    }
    if (newEmails.length > 0) {
      // Firm-scoped uniqueness check, bounded by the new-attendee
      // emails (`email: { in: ... }`) — never the whole Contact
      // table. Postgres backs `mode: "insensitive"` so the
      // case-folding happens in the query; the Map below only
      // re-lowercases the returned handful of rows to pair each
      // collision with the existing contact's name for the error
      // message. The OR-firmId-null branch matches legacy
      // unbackfilled rows so single-tenant duplicates still get
      // caught — drop that clause once Contact.firmId is required.
      const existing = await prisma.contact.findMany({
        where: {
          isActive: true,
          email: { in: newEmails, mode: "insensitive" },
          OR: [{ firmId: firm.id }, { firmId: null }],
        },
        select: { email: true, name: true },
      });
      const existingByEmail = new Map<string, string>(
        existing
          .filter((c) => c.email)
          .map((c) => [c.email!.toLowerCase(), c.name])
      );
      const collision = newEmails.find((e) => existingByEmail.has(e));
      if (collision) {
        return {
          status: "error",
          errors: {
            attendees: [
              `A contact with email "${collision}" already exists (${existingByEmail.get(collision)}). Pick them from the list instead of creating a duplicate.`,
            ],
          },
        };
      }
    }
  }

  const allDay = parsed.data.isAllDay === "on";
  // Re-parse here — the superRefine validated shape, but didn't
  // hand us the parsed Date. Both calls succeed at this point
  // because the schema would have errored otherwise.
  const startDate = parseEventBoundary(parsed.data.startTime, allDay)!;
  const endDate = parseEventBoundary(parsed.data.endTime, allDay)!;

  await prisma.$transaction(async (tx) => {
    await tx.calendarEvent.update({
      where: { id: eventId },
      data: {
        title: parsed.data.title,
        type: parsed.data.type,
        isAllDay: allDay,
        startTime: startDate,
        endTime: endDate,
        location: parsed.data.location || null,
        zoomUrl: parsed.data.zoomUrl || null,
        description: parsed.data.description || null,
        visibility: parsed.data.visibility,
      },
    });
    // Replace-all attendees — simpler than a diff at this scale,
    // and existing rows had no per-attendee state worth preserving
    // (status defaults to "pending" today; RSVP isn't wired yet).
    await tx.calendarAttendee.deleteMany({ where: { eventId } });

    if (resolvedAttendees.length > 0) {
      // Each resolved entry becomes a CalendarAttendee row.
      // Linked user/contact entries were validated (and their
      // FKs resolved) before the transaction opened — only
      // writes happen in here.
      for (const r of resolvedAttendees) {
        const a = r.entry;
        const userId = r.userId;
        let contactId = r.contactId;

        if (a.kind === "new") {
          // "new" branch — create a Contact (type=other) so the
          // arbitrary entry becomes a real directory row. The
          // pre-transaction check above already ruled out
          // duplicate emails within the firm; firmId is stamped
          // here so the row joins the firm's directory cleanly
          // from the moment it's born.
          const trimmedName = a.name.trim();
          const trimmedEmail = a.email?.trim() || null;
          const created = await tx.contact.create({
            data: {
              firmId: firm.id,
              name: trimmedName,
              email: trimmedEmail,
              type: "other",
            },
            select: { id: true },
          });
          contactId = created.id;
        }

        // Status semantics: firm-user attendees are implicitly
        // attending — if a teammate added them, the assumption
        // is "they're going" — so we mark them `accepted`.
        // External rows (contact pick or new-contact create)
        // stay `pending` until a real RSVP flow lands. The
        // modal hides the pill for `accepted` so we don't show
        // a noisy "Accepted" label next to every teammate;
        // pending/declined/tentative still surface.
        const status = userId ? "accepted" : "pending";
        await tx.calendarAttendee.create({
          data: {
            eventId,
            userId,
            contactId,
            // Snapshot the display name + email regardless of
            // which branch we took. Renaming a user/contact
            // later won't silently rewrite past attendance.
            name: a.name.trim(),
            email: a.email?.trim() || null,
            status,
          },
        });
      }
    }
  });

  revalidateForEvent(event.matterId);
  return { status: "ok" };
}

// ── Delete ──────────────────────────────────────────────────────────────

export async function deleteCalendarEvent(
  eventId: string
): Promise<{ ok: boolean; error?: string; matterId: string | null }> {
  const event = await prisma.calendarEvent.findUnique({
    where: { id: eventId },
    select: {
      matterId: true,
      createdById: true,
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
  const viewerId = await getCurrentUserId();
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

  await prisma.calendarEvent.delete({ where: { id: eventId } });

  revalidateForEvent(event.matterId);
  return { ok: true, matterId: event.matterId };
}

/**
 * Delete-and-redirect helper for the modal footer's Delete button —
 * after the event is gone, send the user to the calendar (or back to
 * the matter's events tab if there was one).
 */
export async function deleteCalendarEventAndRedirect(
  eventId: string
): Promise<void> {
  const result = await deleteCalendarEvent(eventId);
  if (!result.ok) return;
  if (result.matterId) {
    redirect(`/matters/${result.matterId}/events`);
  }
  redirect("/calendar");
}

// ── Standalone create (calendar page's "+ New event") ─────────────────

const createCalendarEventSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(200),
    type: z.enum(EVENT_TYPES).default("meeting"),
    isAllDay: z.literal("on").optional(),
    startTime: z.string().min(1, "Start time is required"),
    endTime: z.string().min(1, "End time is required"),
    location: z.string().max(200).optional().or(z.literal("")),
    zoomUrl: z.string().max(500).optional().or(z.literal("")),
    description: z.string().max(4000).optional().or(z.literal("")),
    /** Optional. When omitted / empty the event has no matter
     *  scope — the user's "personal" event in effect. When set,
     *  it's a matter event (visible to the matter team). */
    matterId: z.string().optional().or(z.literal("")),
    /** Per-event visibility override. Defaults to "default"
     *  (resolver decides: creator + attendees + matter team see;
     *  everyone else sees Busy). "show_details" makes this event
     *  firm-wide visible regardless of relationship. */
    visibility: z
      .enum(["default", "show_details"])
      .optional()
      .default("default"),
  })
  .superRefine((data, ctx) => {
    const allDay = data.isAllDay === "on";
    const start = parseEventBoundary(data.startTime, allDay);
    const end = parseEventBoundary(data.endTime, allDay);
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
  });

/**
 * Create a calendar event from the standalone calendar page.
 * `matterId` is optional — without one the event is on the
 * user's personal calendar (no matter scope). Doesn't go
 * through `createEventWithCaptures` because the calendar page's
 * composer doesn't surface attached siblings; the matter-detail
 * page still uses that richer flow.
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
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = createCalendarEventSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
    };
  }
  const allDay = parsed.data.isAllDay === "on";
  const startDate = parseEventBoundary(parsed.data.startTime, allDay)!;
  const endDate = parseEventBoundary(parsed.data.endTime, allDay)!;
  const matterId =
    parsed.data.matterId && parsed.data.matterId.length > 0
      ? parsed.data.matterId
      : null;

  // Wrap the create + creator-attendee insert in a transaction
  // so the min-firm-attendee invariant holds atomically — the
  // event never exists without at least one firm attendee.
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
        zoomUrl: parsed.data.zoomUrl || null,
        description: parsed.data.description || null,
        visibility: parsed.data.visibility,
      },
      select: { id: true },
    });
    // Auto-add the creator as a firm-user attendee. Snapshot
    // their name + email so a future rename doesn't rewrite the
    // attendee label. Status `accepted` (creator is implicitly
    // attending — RSVP doesn't apply to "you scheduled this").
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
    return ev;
  });

  // Calendar refreshes via revalidate so the newly-created
  // event shows up on the next render.
  revalidatePath("/calendar");
  revalidatePath("/"); // dashboard "Today's agenda"
  if (matterId) {
    revalidatePath(`/matters/${matterId}/events`);
    revalidatePath(`/matters/${matterId}`);
  }
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

const moveCalendarEventSchema = z
  .object({
    isAllDay: z.boolean(),
    /** ISO 8601 strings — the client builds them from a Date and
     *  POSTs as JSON via the action. We re-parse + revalidate here. */
    startTime: z.string().min(1),
    endTime: z.string().min(1),
  })
  .superRefine((data, ctx) => {
    const start = new Date(data.startTime);
    const end = new Date(data.endTime);
    if (Number.isNaN(start.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startTime"],
        message: "Invalid start",
      });
    }
    if (Number.isNaN(end.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endTime"],
        message: "Invalid end",
      });
    }
    if (
      !Number.isNaN(start.getTime()) &&
      !Number.isNaN(end.getTime()) &&
      end.getTime() < start.getTime()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endTime"],
        message: "End must be on or after start",
      });
    }
  });

export async function moveCalendarEvent(
  eventId: string,
  input: { isAllDay: boolean; startTime: string; endTime: string }
): Promise<{ ok: boolean; error?: string }> {
  const parsed = moveCalendarEventSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Invalid move." };
  }

  const event = await prisma.calendarEvent.findUnique({
    where: { id: eventId },
    select: {
      matterId: true,
      createdById: true,
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
  const viewerId = await getCurrentUserId();
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

  await prisma.calendarEvent.update({
    where: { id: eventId },
    data: {
      isAllDay: parsed.data.isAllDay,
      startTime: new Date(parsed.data.startTime),
      endTime: new Date(parsed.data.endTime),
    },
  });

  revalidateForEvent(event.matterId);
  return { ok: true };
}
