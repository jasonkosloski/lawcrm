/**
 * Notification mutating actions.
 *
 * Just two — mark a single row read (when the user clicks one in
 * the bell dropdown) and mark every unread row read (the "clear
 * all" affordance). Both are scoped strictly to the current user;
 * the where-clause includes userId so a stale clientId can't flip
 * someone else's row.
 *
 * Auth: the actions hit the recipient's own row only, so the gate
 * is identity (current user) — no permission key. Reading is also
 * identity-scoped via `getCurrentUserId()` in the query.
 */

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import {
  getNotificationsBell,
  type NotificationsBell,
} from "@/lib/queries/notifications";

/** Fetch the current user's bell state. Wraps the query so the
 *  client bell component can self-poll without a separate API
 *  route. */
export async function fetchBellState(): Promise<NotificationsBell> {
  return getNotificationsBell();
}

export async function markNotificationRead(
  notificationId: string
): Promise<{ ok: boolean }> {
  const userId = await getCurrentUserId();
  // Scoped update — `userId` in the where clause means another
  // user's row can't be flipped via a guessed id.
  const result = await prisma.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: new Date() },
  });
  if (result.count > 0) {
    revalidatePath("/", "layout");
  }
  return { ok: true };
}

export async function markAllNotificationsRead(): Promise<{ ok: boolean }> {
  const userId = await getCurrentUserId();
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  if (result.count > 0) {
    revalidatePath("/", "layout");
  }
  return { ok: true };
}
