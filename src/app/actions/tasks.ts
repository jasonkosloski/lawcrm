/**
 * Task server actions — update, delete, status toggle, owner
 * (re)assignment.
 *
 * Mirrors the notes pattern in `notes.ts`. Create lives in
 * `captures.ts` because tasks can be created with sibling captures;
 * once a task exists the lifecycle here is simpler — no captures, no
 * sanitization, just plain field updates.
 *
 * Every mutation revalidates the matter tasks tab, the matter overview
 * (which previews open tasks), and the dashboard "Your tasks" card.
 *
 * Notifications: `setTaskOwner` writes a "task_assigned" row for the
 * new owner — unless they assigned it to themselves (same actor-
 * exclusion rule as the payment fan-out in `billing.ts`). The create
 * path in `captures.ts` always self-assigns (`ownerId: userId`), so a
 * create-time notification would always be suppressed by that rule;
 * when an owner picker lands on the composer, wire the same helper
 * there.
 *
 * Auth: gated on `tasks.edit` (status + field edits + reassignment)
 * and `tasks.delete`. Admins short-circuit; other roles need explicit
 * grant via the matrix.
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
import { getCurrentUserId } from "@/lib/current-user";
import { requirePermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import { createNotification } from "@/lib/notifications";

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
  await requirePermission("tasks.edit");
  if (!(TASK_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: `Unknown status: ${status}` };
  }

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { matterId: true, status: true, title: true },
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

  // Activity log only for completed/reopened transitions — minor
  // status nudges (open → in_progress) aren't worth dashboard space.
  if (!wasComplete && isComplete) {
    const userId = await getCurrentUserId();
    await logActivity({
      matterId: task.matterId,
      userId,
      type: "task_complete",
      title: status === "cancelled" ? "Task cancelled" : "Task completed",
      detail: task.title,
    });
  } else if (wasComplete && !isComplete) {
    const userId = await getCurrentUserId();
    await logActivity({
      matterId: task.matterId,
      userId,
      type: "task",
      title: "Task reopened",
      detail: task.title,
    });
  }

  return { ok: true };
}

// ── Owner assignment ────────────────────────────────────────────────────

/** Assign (or clear) a task's owner. Notifies the new owner via a
 *  "task_assigned" notification — skipped on self-assignment (no
 *  point pinging your own bell) and on no-op calls where the owner
 *  didn't actually change. */
export async function setTaskOwner(
  taskId: string,
  ownerId: string | null
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("tasks.edit");
  const actorId = await getCurrentUserId();

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { matterId: true, ownerId: true, title: true },
  });
  if (!task) return { ok: false, error: "Task not found" };
  if (task.ownerId === ownerId) return { ok: true }; // no-op — don't re-notify

  if (ownerId) {
    const owner = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { isActive: true },
    });
    if (!owner || !owner.isActive) {
      return { ok: false, error: "Assignee not found or inactive" };
    }
  }

  await prisma.task.update({
    where: { id: taskId },
    data: { ownerId },
  });

  revalidateForTask(task.matterId);

  // Tell the new owner — unless they just assigned it to themselves
  // (same actor-exclusion rule as the invoice-payment fan-out in
  // `billing.ts`). Fire-and-forget: a failed notification write never
  // rolls back the reassignment.
  if (ownerId && ownerId !== actorId) {
    const matter = task.matterId
      ? await prisma.matter.findUnique({
          where: { id: task.matterId },
          select: { name: true },
        })
      : null;
    await createNotification({
      userId: ownerId,
      type: "task_assigned",
      title: `Task assigned: ${task.title}`,
      body: matter ? matter.name : "Firm-wide task",
      link: task.matterId ? `/matters/${task.matterId}/tasks` : "/",
      matterId: task.matterId,
    });
  }

  return { ok: true };
}

// ── Delete ──────────────────────────────────────────────────────────────

export async function deleteTask(
  taskId: string
): Promise<{ ok: boolean; error?: string }> {
  await requirePermission("tasks.delete");
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

/** Convert the form's `YYYY-MM-DD` dueDate to local midnight of that
 *  day. We don't use `new Date(value)` directly because that parses
 *  ISO date-only as UTC midnight, while the edit dialog reads the
 *  stored Date back with local-time getters — west of UTC the due
 *  date would display a day early and drift a day earlier on every
 *  unmodified save. Same rule as `parseEventBoundary` in
 *  `calendar-events.ts`. Returns null on empty input or parse
 *  failure. */
function parseDueDate(value: string | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function updateTask(
  taskId: string,
  _prev: UpdateTaskFormState,
  formData: FormData
): Promise<UpdateTaskFormState> {
  await requirePermission("tasks.edit");
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
      dueDate: parseDueDate(parsed.data.dueDate),
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
