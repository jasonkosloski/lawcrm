/**
 * Time entry server actions.
 *
 * The matter Time tab's full `createTimeEntryWithCaptures` lives in
 * captures.ts (primary + attached siblings). These narrower actions
 * are for in-place creation from other surfaces — for now, the
 * event-scoped "log time for this event" composer on the Events
 * tab + event detail modal.
 *
 * Accepts calendarEventId so the server links the entry directly to
 * the event; revalidation reaches back into the calendar and matter
 * events tab so both UIs reflect the new row immediately.
 *
 * TODO (auth): gate delete + edit once RBAC lands.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import {
  TIME_ENTRY_STATUSES,
  type TimeEntryStatus,
} from "@/lib/note-constants";
import type { TimeEntryFormState } from "@/lib/time-entry-constants";

const timeEntrySchema = z.object({
  date: z.string().min(1, "Date is required"),
  hours: z
    .string()
    .min(1, "Hours required")
    .refine((v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 && n <= 24;
    }, "Hours must be > 0 and ≤ 24"),
  activity: z.string().trim().min(1, "Activity is required").max(200),
  narrative: z.string().max(4000).optional().or(z.literal("")),
  billable: z.literal("on").optional(),
  noCharge: z.literal("on").optional(),
  privileged: z.literal("on").optional(),
  calendarEventId: z.string().trim().optional().or(z.literal("")),
});

export async function createTimeEntry(
  matterId: string,
  _prev: TimeEntryFormState,
  formData: FormData
): Promise<TimeEntryFormState> {
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = timeEntrySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      values: raw,
    };
  }

  // Guard that the matter exists before writing.
  const matter = await prisma.matter.findUnique({
    where: { id: matterId },
    select: { id: true },
  });
  if (!matter) {
    return {
      status: "error",
      errors: { activity: ["Matter not found"] },
      values: raw,
    };
  }

  const userId = await getCurrentUserId();

  await prisma.timeEntry.create({
    data: {
      matterId,
      userId,
      date: new Date(parsed.data.date),
      hours: Number(parsed.data.hours),
      activity: parsed.data.activity,
      narrative: parsed.data.narrative || null,
      billable: parsed.data.billable === "on",
      noCharge: parsed.data.noCharge === "on",
      privileged: parsed.data.privileged === "on",
      source: parsed.data.calendarEventId ? "calendar" : "manual",
      calendarEventId: parsed.data.calendarEventId || null,
    },
  });

  revalidatePath(`/matters/${matterId}/time`);
  revalidatePath(`/matters/${matterId}`);
  if (parsed.data.calendarEventId) {
    revalidatePath(`/matters/${matterId}/events`);
    revalidatePath(`/calendar`);
  }
  return { status: "ok" };
}

// ── Update ──────────────────────────────────────────────────────────────

const updateTimeEntrySchema = z.object({
  date: z.string().min(1, "Date is required"),
  hours: z
    .string()
    .min(1, "Hours required")
    .refine((v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 && n <= 24;
    }, "Hours must be > 0 and ≤ 24"),
  activity: z.string().trim().min(1, "Activity is required").max(200),
  narrative: z.string().max(4000).optional().or(z.literal("")),
  billable: z.literal("on").optional(),
  noCharge: z.literal("on").optional(),
  privileged: z.literal("on").optional(),
  status: z.enum(TIME_ENTRY_STATUSES).default("draft"),
});

export async function updateTimeEntry(
  timeEntryId: string,
  _prev: TimeEntryFormState,
  formData: FormData
): Promise<TimeEntryFormState> {
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = updateTimeEntrySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      values: raw,
    };
  }

  const entry = await prisma.timeEntry.findUnique({
    where: { id: timeEntryId },
    select: { matterId: true, calendarEventId: true, status: true },
  });
  if (!entry) {
    return {
      status: "error",
      errors: { activity: ["Time entry no longer exists"] },
      values: raw,
    };
  }

  // Once a time entry is on a sent invoice (status: billed), the
  // accounting record is essentially closed. Editing those fields
  // silently would put the invoice and the WIP out of sync. Block
  // edits here too — same posture as `deleteTimeEntry`.
  if (entry.status === "billed" && parsed.data.status === "billed") {
    return {
      status: "error",
      errors: {
        activity: ["Entry is already billed. Unbill it before editing."],
      },
      values: raw,
    };
  }

  await prisma.timeEntry.update({
    where: { id: timeEntryId },
    data: {
      date: new Date(parsed.data.date),
      hours: Number(parsed.data.hours),
      activity: parsed.data.activity,
      narrative: parsed.data.narrative || null,
      billable: parsed.data.billable === "on",
      noCharge: parsed.data.noCharge === "on",
      privileged: parsed.data.privileged === "on",
      status: parsed.data.status,
    },
  });

  revalidatePath(`/matters/${entry.matterId}/time`);
  revalidatePath(`/matters/${entry.matterId}`);
  if (entry.calendarEventId) {
    revalidatePath(`/matters/${entry.matterId}/events`);
    revalidatePath(`/calendar`);
  }
  return { status: "ok" };
}

// ── Status ──────────────────────────────────────────────────────────────

export async function setTimeEntryStatus(
  timeEntryId: string,
  status: TimeEntryStatus
): Promise<{ ok: boolean; error?: string }> {
  if (!(TIME_ENTRY_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: `Unknown status: ${status}` };
  }

  const entry = await prisma.timeEntry.findUnique({
    where: { id: timeEntryId },
    select: { matterId: true, calendarEventId: true },
  });
  if (!entry) return { ok: false, error: "Time entry not found" };

  await prisma.timeEntry.update({
    where: { id: timeEntryId },
    data: { status },
  });

  revalidatePath(`/matters/${entry.matterId}/time`);
  revalidatePath(`/matters/${entry.matterId}`);
  if (entry.calendarEventId) {
    revalidatePath(`/matters/${entry.matterId}/events`);
    revalidatePath(`/calendar`);
  }
  return { ok: true };
}

export async function deleteTimeEntry(
  timeEntryId: string
): Promise<{ ok: boolean; error?: string }> {
  const entry = await prisma.timeEntry.findUnique({
    where: { id: timeEntryId },
    select: { id: true, matterId: true, calendarEventId: true, status: true },
  });
  if (!entry) return { ok: false, error: "Time entry not found" };
  // Don't let users delete entries that are already on an invoice —
  // accounting hygiene. Unbill first.
  if (entry.status === "billed") {
    return {
      ok: false,
      error: "Entry is already billed. Unbill it before deleting.",
    };
  }

  await prisma.timeEntry.delete({ where: { id: timeEntryId } });

  revalidatePath(`/matters/${entry.matterId}/time`);
  revalidatePath(`/matters/${entry.matterId}`);
  if (entry.calendarEventId) {
    revalidatePath(`/matters/${entry.matterId}/events`);
    revalidatePath(`/calendar`);
  }
  return { ok: true };
}
