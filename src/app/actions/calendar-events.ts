/**
 * Calendar event server actions — update, delete.
 *
 * Edit lives at /calendar/events/[eventId]/edit (linked from the event
 * detail modal). Delete fires from the modal footer with a confirm.
 */

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { EVENT_TYPES } from "@/lib/note-constants";
import type { UpdateCalendarEventFormState } from "@/lib/calendar-event-form";

function revalidateForEvent(matterId: string | null): void {
  revalidatePath("/calendar");
  revalidatePath("/"); // dashboard "Today's agenda"
  if (matterId) {
    revalidatePath(`/matters/${matterId}/events`);
    revalidatePath(`/matters/${matterId}`);
  }
}

// ── Update ──────────────────────────────────────────────────────────────

const attendeeEntrySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().max(200).optional().or(z.literal("")),
});

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
    select: { matterId: true },
  });
  if (!event) {
    return {
      status: "error",
      errors: { title: ["Event no longer exists"] },
    };
  }

  // Parse + validate the attendees list before opening the
  // transaction so a malformed payload doesn't half-update the
  // event's core fields.
  let attendeeList: Array<{ name: string; email: string }> = [];
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
      attendeeList.push({ name: r.data.name, email: r.data.email ?? "" });
    }
  } catch {
    return {
      status: "error",
      errors: { attendees: ["Attendee list was malformed — try again."] },
    };
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
      },
    });
    // Replace-all attendees — simpler than a diff at this scale,
    // and existing rows had no per-attendee state worth preserving
    // (status defaults to "pending" today; RSVP isn't wired yet).
    await tx.calendarAttendee.deleteMany({ where: { eventId } });
    if (attendeeList.length > 0) {
      await tx.calendarAttendee.createMany({
        data: attendeeList.map((a) => ({
          eventId,
          name: a.name,
          email: a.email || null,
          status: "pending",
        })),
      });
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
    select: { matterId: true },
  });
  if (!event) return { ok: false, error: "Event not found", matterId: null };

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
