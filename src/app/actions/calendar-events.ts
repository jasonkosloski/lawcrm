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

const updateEventSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(200),
    type: z.enum(EVENT_TYPES).default("meeting"),
    startTime: z.string().min(1, "Start time is required"),
    endTime: z.string().min(1, "End time is required"),
    location: z.string().max(200).optional().or(z.literal("")),
    zoomUrl: z.string().max(500).optional().or(z.literal("")),
    description: z.string().max(4000).optional().or(z.literal("")),
  })
  .superRefine((data, ctx) => {
    const start = new Date(data.startTime);
    const end = new Date(data.endTime);
    if (Number.isNaN(start.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startTime"],
        message: "Invalid start time",
      });
    }
    if (Number.isNaN(end.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endTime"],
        message: "Invalid end time",
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
        message: "End must be after start",
      });
    }
  });

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

  await prisma.calendarEvent.update({
    where: { id: eventId },
    data: {
      title: parsed.data.title,
      type: parsed.data.type,
      startTime: new Date(parsed.data.startTime),
      endTime: new Date(parsed.data.endTime),
      location: parsed.data.location || null,
      zoomUrl: parsed.data.zoomUrl || null,
      description: parsed.data.description || null,
    },
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
