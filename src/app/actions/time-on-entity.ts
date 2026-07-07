/**
 * "Log time on this <task|deadline>" server actions.
 *
 * Same shape as `addTimeEntryToNote` in note-attachments.ts but
 * scoped to a Task / Deadline parent. Resolves the parent's
 * matter, refuses if the parent is missing, sets the appropriate
 * FK so the entry's "From task" / "From deadline" chip renders.
 *
 * Auth: every action here gates on `time_entries.create` — same
 * key as the sibling create paths (time-entries.ts, captures.ts),
 * so denying that permission closes ALL time-logging entry points.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { parseLocalDate } from "@/lib/format-date";
import { requirePermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import type { NoteAttachmentFormState } from "@/lib/note-attachment-form";

/** Trim a string to N chars, appending "…" only when actually truncated. */
function snippet(s: string | null | undefined, max: number): string {
  if (!s) return "";
  const stripped = s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return stripped.length <= max ? stripped : stripped.slice(0, max - 1) + "…";
}

const timeSchema = z.object({
  // Date-only "YYYY-MM-DD" from <input type="date"> → LOCAL midnight
  // via parseLocalDate. `new Date(value)` would read it as UTC
  // midnight, drifting the entry a day early for anyone west of UTC.
  // Transform in the schema so all four actions below share the fix.
  date: z
    .string()
    .min(1, "Date is required")
    .transform((v, ctx) => {
      const d = parseLocalDate(v);
      if (!d) {
        ctx.addIssue({ code: "custom", message: "Invalid date" });
        return z.NEVER;
      }
      return d;
    }),
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
});

// ── Task ────────────────────────────────────────────────────────────────

export async function addTimeEntryToTask(
  taskId: string,
  _prev: NoteAttachmentFormState,
  formData: FormData
): Promise<NoteAttachmentFormState> {
  await requirePermission("time_entries.create");
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = timeSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", errors: parsed.error.flatten().fieldErrors };
  }
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { matterId: true, title: true },
  });
  if (!task || !task.matterId) {
    return {
      status: "error",
      errors: { activity: ["Task no longer exists or isn't on a matter"] },
    };
  }
  const userId = await getCurrentUserId();
  await prisma.timeEntry.create({
    data: {
      matterId: task.matterId,
      userId,
      taskId,
      date: parsed.data.date,
      hours: Number(parsed.data.hours),
      activity: parsed.data.activity,
      narrative: parsed.data.narrative || null,
      billable: parsed.data.billable === "on",
      noCharge: parsed.data.noCharge === "on",
      privileged: parsed.data.privileged === "on",
      // 'task' is one of the canonical source kinds in the schema's
      // documented enum — labels the time entry as having come out
      // of a task workflow, not generic manual entry.
      source: "task",
    },
  });

  revalidatePath(`/matters/${task.matterId}/tasks`);
  revalidatePath(`/matters/${task.matterId}/time`);
  revalidatePath(`/matters/${task.matterId}`);
  await logActivity({
    matterId: task.matterId,
    userId,
    type: "time_entry",
    title: `Time logged on task · ${parsed.data.hours}h`,
    detail: `${task.title}: ${parsed.data.activity}`,
  });
  return { status: "ok" };
}

// ── Deadline ────────────────────────────────────────────────────────────

export async function addTimeEntryToDeadline(
  deadlineId: string,
  _prev: NoteAttachmentFormState,
  formData: FormData
): Promise<NoteAttachmentFormState> {
  await requirePermission("time_entries.create");
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = timeSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", errors: parsed.error.flatten().fieldErrors };
  }
  const deadline = await prisma.deadline.findUnique({
    where: { id: deadlineId },
    select: { matterId: true, title: true },
  });
  if (!deadline) {
    return {
      status: "error",
      errors: { activity: ["Deadline no longer exists"] },
    };
  }
  const userId = await getCurrentUserId();
  await prisma.timeEntry.create({
    data: {
      matterId: deadline.matterId,
      userId,
      deadlineId,
      date: parsed.data.date,
      hours: Number(parsed.data.hours),
      activity: parsed.data.activity,
      narrative: parsed.data.narrative || null,
      billable: parsed.data.billable === "on",
      noCharge: parsed.data.noCharge === "on",
      privileged: parsed.data.privileged === "on",
      source: "manual",
    },
  });

  revalidatePath(`/matters/${deadline.matterId}/deadlines`);
  revalidatePath(`/matters/${deadline.matterId}/time`);
  revalidatePath(`/matters/${deadline.matterId}`);
  await logActivity({
    matterId: deadline.matterId,
    userId,
    type: "time_entry",
    title: `Time logged on deadline · ${parsed.data.hours}h`,
    detail: `${deadline.title}: ${parsed.data.activity}`,
  });
  return { status: "ok" };
}

// ── Per-email-message ───────────────────────────────────────────────────

export async function addTimeEntryToEmailMessage(
  emailMessageId: string,
  _prev: NoteAttachmentFormState,
  formData: FormData
): Promise<NoteAttachmentFormState> {
  await requirePermission("time_entries.create");
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = timeSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", errors: parsed.error.flatten().fieldErrors };
  }
  // Pull the message and its thread so we can resolve the matter.
  const msg = await prisma.emailMessage.findUnique({
    where: { id: emailMessageId },
    select: {
      id: true,
      fromName: true,
      thread: { select: { matterId: true, subject: true } },
    },
  });
  if (!msg || !msg.thread.matterId) {
    return {
      status: "error",
      errors: {
        activity: ["Email isn't filed to a matter — file the thread first"],
      },
    };
  }
  const userId = await getCurrentUserId();
  await prisma.timeEntry.create({
    data: {
      matterId: msg.thread.matterId,
      userId,
      emailMessageId,
      date: parsed.data.date,
      hours: Number(parsed.data.hours),
      activity: parsed.data.activity,
      narrative: parsed.data.narrative || null,
      billable: parsed.data.billable === "on",
      noCharge: parsed.data.noCharge === "on",
      privileged: parsed.data.privileged === "on",
      // 'email' is one of the canonical source kinds in the schema.
      source: "email",
    },
  });

  revalidatePath("/communication");
  revalidatePath(`/matters/${msg.thread.matterId}/communication`);
  revalidatePath(`/matters/${msg.thread.matterId}/time`);
  revalidatePath(`/matters/${msg.thread.matterId}`);
  await logActivity({
    matterId: msg.thread.matterId,
    userId,
    type: "time_entry",
    title: `Time logged on email · ${parsed.data.hours}h`,
    detail: `${snippet(msg.thread.subject, 40)} (${msg.fromName}): ${parsed.data.activity}`,
  });
  return { status: "ok" };
}

// ── Per-messenger-item (SMS / call / voicemail) ─────────────────────────

export async function addTimeEntryToMessengerItem(
  messengerItemId: string,
  _prev: NoteAttachmentFormState,
  formData: FormData
): Promise<NoteAttachmentFormState> {
  await requirePermission("time_entries.create");
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = timeSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", errors: parsed.error.flatten().fieldErrors };
  }
  const item = await prisma.messengerItem.findUnique({
    where: { id: messengerItemId },
    select: {
      id: true,
      kind: true,
      matterId: true,
      thread: {
        select: {
          defaultMatterId: true,
          contactPhone: true,
          contact: { select: { name: true } },
        },
      },
    },
  });
  if (!item) {
    return {
      status: "error",
      errors: { activity: ["Item not found"] },
    };
  }
  // Item-level matterId wins; fall back to thread default — same
  // resolution as resolveMessengerMatter in inbox-actions.ts.
  const matterId = item.matterId ?? item.thread?.defaultMatterId ?? null;
  if (!matterId) {
    return {
      status: "error",
      errors: {
        activity: ["This conversation isn't filed to a matter yet."],
      },
    };
  }
  const userId = await getCurrentUserId();
  const who =
    item.thread?.contact?.name ?? item.thread?.contactPhone ?? "Unknown";
  await prisma.timeEntry.create({
    data: {
      matterId,
      userId,
      messengerItemId,
      date: parsed.data.date,
      hours: Number(parsed.data.hours),
      activity: parsed.data.activity,
      narrative: parsed.data.narrative || null,
      billable: parsed.data.billable === "on",
      noCharge: parsed.data.noCharge === "on",
      privileged: parsed.data.privileged === "on",
      // Provider-channel labelling — sms/voicemail map to 'email'-
      // adjacent in the schema enum, so fall through to manual.
      source: "manual",
    },
  });

  revalidatePath("/communication");
  revalidatePath(`/matters/${matterId}/communication`);
  revalidatePath(`/matters/${matterId}/time`);
  revalidatePath(`/matters/${matterId}`);
  await logActivity({
    matterId,
    userId,
    type: "time_entry",
    title: `Time logged on ${item.kind} · ${parsed.data.hours}h`,
    detail: `${who}: ${parsed.data.activity}`,
  });
  return { status: "ok" };
}
