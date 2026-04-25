/**
 * "Log time on this <task|deadline>" server actions.
 *
 * Same shape as `addTimeEntryToNote` in note-attachments.ts but
 * scoped to a Task / Deadline parent. Resolves the parent's
 * matter, refuses if the parent is missing, sets the appropriate
 * FK so the entry's "From task" / "From deadline" chip renders.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { logActivity } from "@/lib/activity-log";
import type { NoteAttachmentFormState } from "@/lib/note-attachment-form";

const timeSchema = z.object({
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
});

// ── Task ────────────────────────────────────────────────────────────────

export async function addTimeEntryToTask(
  taskId: string,
  _prev: NoteAttachmentFormState,
  formData: FormData
): Promise<NoteAttachmentFormState> {
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
      date: new Date(parsed.data.date),
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
      date: new Date(parsed.data.date),
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
