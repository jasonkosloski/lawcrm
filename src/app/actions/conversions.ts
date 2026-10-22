/**
 * Type conversion actions — promote one entity into another.
 *
 *   convertNoteToTask: note's content → task title (first line) +
 *     description (rest). Sets Task.noteId so the back-link chip
 *     renders on the task. Source note stays intact.
 *
 *   convertTaskToDeadline: task's title → deadline title; due date
 *     comes from the form (deadline requires one, task doesn't).
 *     Sets Deadline.parentTaskId. Source task stays intact.
 *
 * Both actions write activity log entries so the dashboard reflects
 * the conversion as a real user action.
 *
 * Auth: each conversion gates on the *target* entity's create
 * permission (tasks.create / deadlines.create) — a conversion is just
 * another way to create that entity, so it must not bypass the same
 * gate the direct capture path enforces.
 */

"use server";

import { revalidatePath } from "next/cache";
import { revalidateDeadlineSurfaces } from "@/lib/revalidate-deadlines";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assertChildMatterAccess } from "@/lib/matter-access";
import { getCurrentUserId } from "@/lib/current-user";
// Due dates are date-only values stored at UTC midnight (ADR-012).
// parseDateOnly also rejects impossible dates (2026-02-31) so they
// surface as a field error instead of an Invalid Date reaching Prisma.
import { parseDateOnly } from "@/lib/format-date";
import { requirePermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import { DEADLINE_KINDS } from "@/lib/constants/deadline-status";
import { TASK_PRIORITIES } from "@/lib/constants/priority";
import type { InboxActionFormState } from "@/lib/inbox-action-form";

// ── Note → Task ─────────────────────────────────────────────────────────

const noteToTaskSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().max(4000).optional().or(z.literal("")),
  dueDate: z.string().optional().or(z.literal("")),
  priority: z.enum(TASK_PRIORITIES).default("normal"),
});

export async function convertNoteToTask(
  noteId: string,
  _prev: InboxActionFormState,
  formData: FormData,
): Promise<InboxActionFormState> {
  await requirePermission("tasks.create");
  await assertChildMatterAccess("note", noteId);
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = noteToTaskSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", errors: parsed.error.flatten().fieldErrors };
  }

  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { matterId: true, leadId: true },
  });
  if (!note) {
    return {
      status: "error",
      errors: { title: ["Note no longer exists"] },
    };
  }

  const dueDate = parsed.data.dueDate ? parseDateOnly(parsed.data.dueDate) : null;
  if (parsed.data.dueDate && !dueDate) {
    return { status: "error", errors: { dueDate: ["Invalid due date"] } };
  }

  const userId = await getCurrentUserId();
  await prisma.task.create({
    data: {
      matterId: note.matterId,
      leadId: note.matterId ? null : note.leadId,
      noteId,
      title: parsed.data.title,
      description: parsed.data.description || null,
      priority: parsed.data.priority,
      dueDate,
      ownerId: userId,
    },
  });

  if (note.matterId) {
    revalidatePath(`/matters/${note.matterId}/tasks`);
    revalidatePath(`/matters/${note.matterId}/notes`);
    revalidatePath(`/matters/${note.matterId}`);
  } else if (note.leadId) {
    revalidatePath(`/intake/${note.leadId}`, "layout");
  }
  await logActivity({
    matterId: note.matterId,
    leadId: note.matterId ? null : note.leadId,
    userId,
    type: "task",
    title: "Note converted to task",
    detail: parsed.data.title,
  });
  return { status: "ok" };
}

// ── Task → Deadline ─────────────────────────────────────────────────────

const taskToDeadlineSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  dueDate: z.string().min(1, "Due date is required"),
  kind: z.enum(DEADLINE_KINDS).default("manual"),
  description: z.string().max(4000).optional().or(z.literal("")),
});

export async function convertTaskToDeadline(
  taskId: string,
  _prev: InboxActionFormState,
  formData: FormData,
): Promise<InboxActionFormState> {
  await requirePermission("deadlines.create");
  await assertChildMatterAccess("task", taskId);
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = taskToDeadlineSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", errors: parsed.error.flatten().fieldErrors };
  }

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { matterId: true, ownerId: true },
  });
  if (!task || !task.matterId) {
    return {
      status: "error",
      errors: { title: ["Task no longer exists or has no matter"] },
    };
  }

  const dueDate = parseDateOnly(parsed.data.dueDate);
  if (!dueDate) {
    return { status: "error", errors: { dueDate: ["Invalid due date"] } };
  }

  const userId = await getCurrentUserId();
  await prisma.deadline.create({
    data: {
      matterId: task.matterId,
      parentTaskId: taskId,
      title: parsed.data.title,
      dueDate,
      kind: parsed.data.kind,
      description: parsed.data.description || null,
      ownerId: task.ownerId ?? userId,
    },
  });

  revalidateDeadlineSurfaces(task.matterId);
  revalidatePath(`/matters/${task.matterId}/tasks`);
  await logActivity({
    matterId: task.matterId,
    userId,
    type: "deadline",
    title: "Task converted to deadline",
    detail: parsed.data.title,
  });
  return { status: "ok" };
}
