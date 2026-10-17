/**
 * Notification mutating actions.
 *
 * Just two — mark a single row read (when the user clicks one in
 * the bell dropdown) and mark every unread row read (the "clear
 * all" affordance). Both are scoped strictly to the current user;
 * the where-clause includes userId so a stale clientId can't flip
 * someone else's row.
 *
 * No revalidatePath: the bell and the /notifications feed hold their
 * rows in client state (optimistic updates), so re-rendering the
 * current route server-side on every click bought nothing and cost a
 * full page + sidebar query set.
 *
 * Auth: the actions hit the recipient's own row only, so the gate
 * is identity (current user) — no permission key. Reading is also
 * identity-scoped via `getCurrentUserId()` in the query.
 */

"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";

export async function markNotificationRead(
  notificationId: string
): Promise<{ ok: boolean }> {
  const userId = await getCurrentUserId();
  // Scoped update — `userId` in the where clause means another
  // user's row can't be flipped via a guessed id.
  await prisma.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: new Date() },
  });
  return { ok: true };
}

/**
 * Mark the current user's unread notifications read.
 *
 * `upTo` is the cutoff the client was looking at (the `asOf` the bell
 * / feed query returned): only notices created at or before it are
 * marked, so one that landed after the user last fetched — and so was
 * never shown — stays unread instead of being silently cleared.
 * Omitted → everything unread (legacy behavior). An unparseable
 * cutoff is refused rather than widened to "everything".
 */
export async function markAllNotificationsRead(
  upTo?: Date | string | null
): Promise<{ ok: boolean }> {
  const userId = await getCurrentUserId();
  let cutoff: Date | undefined;
  if (upTo !== undefined && upTo !== null) {
    cutoff = upTo instanceof Date ? upTo : new Date(upTo);
    if (Number.isNaN(cutoff.getTime())) return { ok: false };
  }
  await prisma.notification.updateMany({
    where: {
      userId,
      readAt: null,
      ...(cutoff ? { createdAt: { lte: cutoff } } : {}),
    },
    data: { readAt: new Date() },
  });
  return { ok: true };
}
