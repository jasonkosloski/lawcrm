/**
 * Star + archive flags for email threads (Email v1.1).
 *
 * Sibling of `thread-read.ts` — same posture throughout:
 *
 *   - Auth: session gate only (`getCurrentUserId()`), no permission-
 *     catalog key. Star/archive are viewing-inherent organization of
 *     YOUR OWN mailbox, exactly like read-state: threads are scoped
 *     to the caller's connected accounts (`account: { userId }`, the
 *     `getThreadById` filter), so another user's thread — or a bogus
 *     id — never resolves.
 *   - Local write first (local state is the user's intent), then a
 *     Gmail label writeback via `writebackGmailThread`, which NEVER
 *     rejects: auth failures record the reconnect signal on the
 *     account, transients warn and Gmail simply lags. Threads
 *     without an `externalId` (none today — every email thread is
 *     Gmail-synced or send-upserted — but the column is nullable)
 *     just skip writeback.
 *   - No-op discipline: `setEmailThreadArchived` with the current
 *     value writes nothing, revalidates nothing, writes back
 *     nothing. (Star is a toggle, so every accepted call changes
 *     state by construction.)
 *
 * Label mapping (see gmail-writeback.ts for echo-safety):
 *   star    → add STARRED    unstar    → remove STARRED
 *   archive → remove INBOX   unarchive → add INBOX
 */

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { writebackGmailThread } from "@/lib/google/gmail-writeback";

/** The mailbox-scoped thread lookup both actions share. */
async function findOwnThread(threadId: string) {
  const userId = await getCurrentUserId();
  return prisma.emailThread.findFirst({
    where: { id: threadId, account: { userId } },
    select: {
      id: true,
      accountId: true,
      externalId: true,
      matterId: true,
      isStarred: true,
      isArchived: true,
    },
  });
}

export async function toggleEmailThreadStar(
  threadId: string
): Promise<{ ok: boolean; isStarred?: boolean }> {
  const thread = await findOwnThread(threadId);
  // Not the caller's thread (or nonexistent) — refuse without
  // leaking whether the id exists.
  if (!thread) return { ok: false };

  const isStarred = !thread.isStarred;
  await prisma.emailThread.update({
    where: { id: thread.id },
    data: { isStarred },
  });
  if (thread.externalId) {
    await writebackGmailThread(
      thread.accountId,
      thread.externalId,
      isStarred ? { addLabelIds: ["STARRED"] } : { removeLabelIds: ["STARRED"] }
    );
  }
  revalidateThreadSurfaces(thread.matterId);
  return { ok: true, isStarred };
}

export async function setEmailThreadArchived(
  threadId: string,
  archived: boolean
): Promise<{ ok: boolean }> {
  const thread = await findOwnThread(threadId);
  if (!thread) return { ok: false };

  // Already in the requested state — no write, no writeback, no
  // revalidation (same no-op discipline as markEmailThreadRead).
  if (thread.isArchived === archived) return { ok: true };

  await prisma.emailThread.update({
    where: { id: thread.id },
    data: { isArchived: archived },
  });
  if (thread.externalId) {
    await writebackGmailThread(
      thread.accountId,
      thread.externalId,
      archived ? { removeLabelIds: ["INBOX"] } : { addLabelIds: ["INBOX"] }
    );
  }
  revalidateThreadSurfaces(thread.matterId);
  return { ok: true };
}

/** Same surfaces as thread-read's `revalidateUnreadSurfaces` — star
 *  chips + inbox/archived membership render on all three. (Not
 *  shared: "use server" files may only export async functions.) */
function revalidateThreadSurfaces(matterId: string | null): void {
  revalidatePath("/communication");
  if (matterId) revalidatePath(`/matters/${matterId}/communication`);
  revalidatePath("/intake/[id]/communication", "page");
}
