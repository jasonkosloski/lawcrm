/**
 * Task server actions — update, delete, status toggle.
 *
 * Mirrors the notes pattern in `notes.ts`. Create lives in
 * `captures.ts` because tasks can be created with sibling captures;
 * once a task exists the lifecycle here is simpler — no captures, no
 * sanitization, just plain field updates.
 *
 * Every mutation revalidates the matter tasks tab, the matter overview
 * (which previews open tasks), and the dashboard "Your tasks" card.
 *
 * TODO (auth): gate edits + deletes by ownership / firm-admin role
 * once RBAC lands.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskStatus,
} from "@/lib/note-constants";
import type { UpdateTaskFormState } from "@/lib/task-form";

/** Path-revalidate every surface that displays this task. */
function revalidateForTask(matterId: string | null): void {
  if (matterId) {
    revalidatePath(`/matters/${matterId}/tasks`);
    revalidatePath(`/matters/${matterId}`);
  }
  revalidatePath("/"); // dashboard "Your tasks" card
}

// ── Status toggle ───────────────────────────────────────────────────────

export async function setTaskStatus(
  taskId: string,
  status: TaskStatus
): Promise<{ ok: boolean; error?: string }> {
  if (!(TASK_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: `Unknown status: ${status}` };
  }

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { matterId: true, status: true },
  });
  if (!task) return { ok: false, error: "Task not found" };

  // `completedAt` mirrors status — set when entering done/cancelled,
  // clear when leaving. Keeps queries that filter "completed in last 7
  // days" honest without an extra column write at the call site.
  const isComplete = status === "done" || status === "cancelled";
  const wasComplete = task.status === "done" || task.status === "cancelled";

  await prisma.task.update({
    where: { id: taskId },
    data: {
      status,
      completedAt: isComplete
        ? wasComplete
          ? undefined // already completed — don't overwrite the original timestamp
          : new Date()
        : null,
    },
  });

  revalidateForTask(task.matterId);
  return { ok: true };
}

// ── Delete ──────────────────────────────────────────────────────────────

export async function deleteTask(
  taskId: string
): Promise<{ ok: boolean; error?: string }> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { matterId: true },
  });
  if (!task) return { ok: false, error: "Task not found" };

  await prisma.task.delete({ where: { id: taskId } });

  revalidateForTask(task.matterId);
  return { ok: true };
}

// ── Update ──────────────────────────────────────────────────────────────

const updateTaskSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().max(4000).optional().or(z.literal("")),
  dueDate: z.string().optional().or(z.literal("")),
  priority: z.enum(TASK_PRIORITIES).default("normal"),
  status: z.enum(TASK_STATUSES).default("open"),
});

export async function updateTask(
  taskId: string,
  _prev: UpdateTaskFormState,
  formData: FormData
): Promise<UpdateTaskFormState> {
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = updateTaskSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { matterId: true, status: true },
  });
  if (!task) {
    return {
      status: "error",
      errors: { title: ["Task no longer exists"] },
    };
  }

  const newStatus = parsed.data.status;
  const isComplete = newStatus === "done" || newStatus === "cancelled";
  const wasComplete = task.status === "done" || task.status === "cancelled";

  await prisma.task.update({
    where: { id: taskId },
    data: {
      title: parsed.data.title,
      description: parsed.data.description || null,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
      priority: parsed.data.priority,
      status: newStatus,
      completedAt: isComplete
        ? wasComplete
          ? undefined
          : new Date()
        : null,
    },
  });

  revalidateForTask(task.matterId);
  return { status: "ok" };
}
