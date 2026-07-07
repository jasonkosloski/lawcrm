/**
 * Task-assignment helpers — server-only.
 *
 * Shared between every path that can set a task's owner:
 *   - `setTaskOwner` / `updateTask` in src/app/actions/tasks.ts
 *   - `createTaskWithCaptures` in src/app/actions/captures.ts
 *
 * One home for the two rules so create-time and reassignment
 * behave identically:
 *   1. an assignee must be an existing, ACTIVE user;
 *   2. the new owner gets a "task_assigned" notification — unless
 *      they assigned it to themselves (actor exclusion, same rule
 *      as the payment fan-out in billing.ts) or the task is being
 *      unassigned.
 */

import { prisma } from "@/lib/prisma";
import { createNotification } from "@/lib/notifications";

/** True when `ownerId` refers to an existing, active user. Callers
 *  surface the failure as a field error / result error — inactive
 *  users keep their historical assignments but can't receive new
 *  ones. */
export async function isAssignableUser(ownerId: string): Promise<boolean> {
  const owner = await prisma.user.findUnique({
    where: { id: ownerId },
    select: { isActive: true },
  });
  return owner?.isActive === true;
}

/** Write the "task_assigned" notification for a (re)assignment.
 *  No-ops when the task is unassigned (`ownerId` null) or the new
 *  owner IS the actor. Fire-and-forget downstream: a failed
 *  notification write never rolls back the assignment (see
 *  `createNotification`). Callers are responsible for only calling
 *  this when the owner actually CHANGED — re-notifying on a no-op
 *  save would spam the bell. */
export async function notifyTaskAssigned(opts: {
  ownerId: string | null;
  actorId: string;
  taskTitle: string;
  matterId: string | null;
}): Promise<void> {
  const { ownerId, actorId, taskTitle, matterId } = opts;
  if (!ownerId || ownerId === actorId) return;

  const matter = matterId
    ? await prisma.matter.findUnique({
        where: { id: matterId },
        select: { name: true },
      })
    : null;
  await createNotification({
    userId: ownerId,
    type: "task_assigned",
    title: `Task assigned: ${taskTitle}`,
    body: matter ? matter.name : "Firm-wide task",
    link: matterId ? `/matters/${matterId}/tasks` : "/",
    matterId,
  });
}
