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
 * Auth: `create` gated on `time_entries.create`. Edit + delete gate
 * on author-or-`time_entries.edit_any` / `delete_any` — loggers can
 * always touch their own entries; crossing the ownership line needs
 * the explicit permission. Admins short-circuit either path.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
// Date-only input ("YYYY-MM-DD") must parse to LOCAL midnight —
// `new Date(value)` reads it as UTC midnight, which drifts the entry
// a day early for anyone west of UTC. See parseLocalDate docs.
import { parseLocalDate } from "@/lib/format-date";
import { requirePermission } from "@/lib/permission-check";
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
  await requirePermission("time_entries.create");
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

  const date = parseLocalDate(parsed.data.date);
  if (!date) {
    return {
      status: "error",
      errors: { date: ["Invalid date"] },
      values: raw,
    };
  }

  const userId = await getCurrentUserId();

  await prisma.timeEntry.create({
    data: {
      matterId,
      userId,
      date,
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
    select: {
      matterId: true,
      userId: true,
      calendarEventId: true,
      status: true,
      rate: true,
    },
  });
  if (!entry) {
    return {
      status: "error",
      errors: { activity: ["Time entry no longer exists"] },
      values: raw,
    };
  }

  // Author can always edit their own; otherwise require the
  // `_any` permission. Admins pass either path.
  const actorId = await getCurrentUserId();
  if (entry.userId !== actorId) {
    await requirePermission("time_entries.edit_any");
  }

  // Once a time entry is on an invoice (status: billed), the
  // accounting record is essentially closed — its hours/amount are
  // baked into the invoice's stored subtotal, and nothing here
  // recomputes that. Block unconditionally on the entry's *current*
  // status (never trust the posted status; it defaults to "draft") —
  // same posture as `deleteTimeEntry`. Legitimate corrections go
  // through `updateInvoiceLineItem`, which recomputes the invoice
  // totals in the same transaction.
  if (entry.status === "billed") {
    return {
      status: "error",
      errors: {
        activity: ["Entry is already billed. Unbill it before editing."],
      },
      values: raw,
    };
  }

  const date = parseLocalDate(parsed.data.date);
  if (!date) {
    return {
      status: "error",
      errors: { date: ["Invalid date"] },
      values: raw,
    };
  }

  const newHours = Number(parsed.data.hours);

  await prisma.timeEntry.update({
    where: { id: timeEntryId },
    data: {
      date,
      hours: newHours,
      activity: parsed.data.activity,
      narrative: parsed.data.narrative || null,
      billable: parsed.data.billable === "on",
      noCharge: parsed.data.noCharge === "on",
      privileged: parsed.data.privileged === "on",
      status: parsed.data.status,
      // Schema contract: `amount` is hours × rate, and "the action
      // that sets it is responsible for keeping it in sync". An
      // entry picks up a rate via `updateInvoiceLineItem` and keeps
      // it if the invoice is later voided — so changing hours here
      // must recompute amount or the next generateInvoiceFromWip
      // sums a stale Decimal. Null rate (contingent matters) means
      // there's no amount to sync.
      ...(entry.rate ? { amount: entry.rate.mul(newHours) } : {}),
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
    select: {
      matterId: true,
      userId: true,
      calendarEventId: true,
      status: true,
      invoiceId: true,
    },
  });
  if (!entry) return { ok: false, error: "Time entry not found" };

  // Status changes are still edits. Author bypass; otherwise gate.
  const actorId = await getCurrentUserId();
  if (entry.userId !== actorId) {
    await requirePermission("time_entries.edit_any");
  }

  // "billed" belongs to the invoicing pipeline: generateInvoiceFromWip
  // sets it (together with invoiceId), and voiding/deleting the
  // invoice clears it. A manual flip in either direction desyncs the
  // entry from the invoice's stored subtotal/totalAmount.
  if (status === "billed" && entry.status !== "billed") {
    return {
      ok: false,
      error:
        "Entries are marked billed by invoice generation. Add this entry to an invoice instead.",
    };
  }
  if (entry.status === "billed" && status !== "billed" && entry.invoiceId) {
    // Unbilling while invoiceId stays set would strand the entry:
    // excluded from future WIP runs, yet still counted in its old
    // invoice's totals. Void/delete the invoice — that path already
    // resets its entries back to WIP.
    return {
      ok: false,
      error:
        "Entry is on an invoice. Void or delete the invoice to return it to WIP.",
    };
  }

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
    select: { id: true, matterId: true, userId: true, calendarEventId: true, status: true },
  });
  if (!entry) return { ok: false, error: "Time entry not found" };
  // Author can always delete their own unbilled entries; otherwise
  // gate on time_entries.delete_any.
  const actorId = await getCurrentUserId();
  if (entry.userId !== actorId) {
    await requirePermission("time_entries.delete_any");
  }
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
