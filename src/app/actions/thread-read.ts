/**
 * Mark-as-read for communication threads (email + messenger).
 *
 * Fired by the `MarkThreadRead` client island when a thread's reader
 * pane opens — opening a conversation is what "reading" means here,
 * so there's no explicit button.
 *
 * Read models differ per channel (see prisma/schema.prisma):
 *   - Email: `EmailThread.isRead` is the whole model — messages have
 *     no per-row flag, so one scoped update covers it.
 *   - Messenger: per-item `MessengerItem.isRead` PLUS the thread's
 *     denormalized `unreadCount` (kept so the inbox badge doesn't
 *     aggregate every load). Both move in one transaction so the
 *     badge can never disagree with the item rows.
 *
 * Both actions no-op cleanly when the thread is already read — no
 * writes, no revalidations — because the island fires on every open.
 *
 * Auth: session gate only (`getCurrentUserId()`), no permission-
 * catalog key — mirroring notifications' `markNotificationRead`.
 * Read-state is inherent to viewing: anyone who can open the reader
 * may clear its unread badge, and the flag grants nothing beyond
 * what the viewer already sees. Email threads are additionally
 * scoped to the caller's own connected mailboxes (`account:
 * { userId }`, same filter as `getThreadById`); the messenger inbox
 * is firm-shared (MessengerAccount.userId nullable), so there the
 * session check is the gate — same posture as follow-ups.
 */

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";

export async function markEmailThreadRead(
  threadId: string
): Promise<{ ok: boolean }> {
  const userId = await getCurrentUserId();

  // Scoped + conditioned update: `account: { userId }` means another
  // user's thread (or a nonexistent id) is a silent no-op, and
  // `isRead: false` makes the already-read case count 0 so we skip
  // revalidation. Single statement — email has no denormalized
  // counter to keep in sync, so no transaction needed.
  const result = await prisma.emailThread.updateMany({
    where: { id: threadId, account: { userId }, isRead: false },
    data: { isRead: true },
  });
  if (result.count === 0) return { ok: true };

  const thread = await prisma.emailThread.findUnique({
    where: { id: threadId },
    select: { matterId: true },
  });
  revalidateUnreadSurfaces(thread?.matterId ?? null);
  return { ok: true };
}

export async function markMessengerThreadRead(
  threadId: string
): Promise<{ ok: boolean }> {
  // Messenger inbox is firm-wide (see module header) — session
  // check only, no per-account scoping to mirror.
  await getCurrentUserId();

  const thread = await prisma.messengerThread.findUnique({
    where: { id: threadId },
    select: { unreadCount: true, defaultMatterId: true },
  });
  if (!thread) return { ok: false };

  // Item flags + the denormalized counter flip together so a crash
  // between the two can't leave a badge pointing at read rows.
  const changed = await prisma.$transaction(async (tx) => {
    const items = await tx.messengerItem.updateMany({
      where: { threadId, isRead: false },
      data: { isRead: true },
    });
    // Already fully read AND counter already 0 → nothing to do.
    // (`unreadCount > 0` with zero unread items is counter drift —
    // still reset it so the badge heals.)
    if (items.count === 0 && thread.unreadCount === 0) return false;
    await tx.messengerThread.update({
      where: { id: threadId },
      data: { unreadCount: 0 },
    });
    return true;
  });

  if (changed) revalidateUnreadSurfaces(thread.defaultMatterId);
  return { ok: true };
}

/** Every page that renders unread state (bold rows / count badges):
 *  the unified inbox, the matter Communication tab, and the lead
 *  Communication tab. A thread doesn't know which lead(s) show it —
 *  leads match threads on email/phone at query time — so the intake
 *  route revalidates by dynamic-segment pattern instead of a
 *  literal path (revalidatePath's documented `[slug]` + 'page'
 *  form). */
function revalidateUnreadSurfaces(matterId: string | null): void {
  revalidatePath("/communication");
  if (matterId) revalidatePath(`/matters/${matterId}/communication`);
  revalidatePath("/intake/[id]/communication", "page");
}
