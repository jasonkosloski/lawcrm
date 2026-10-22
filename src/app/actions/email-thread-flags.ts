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
 *     Gmail label writeback (archive: `writebackGmailMessages` over
 *     the synced message ids only; star: `writebackGmailThread`), which NEVER
 *     rejects: auth failures record the reconnect signal on the
 *     account, transients warn. The local flag is KEPT, but Gmail's
 *     labels win the next time sync reports that thread (the sync
 *     re-derives isRead/isStarred/isArchived from labels), so a
 *     failed writeback can revert itself later. Threads
 *     without an `externalId` (none today — every email thread is
 *     Gmail-synced or send-upserted — but the column is nullable)
 *     just skip writeback.
 *   - No-op discipline: `setEmailThreadArchived` /
 *     `setEmailThreadStarred` with the current value write nothing,
 *     revalidate nothing, write back nothing. Both take the DESIRED
 *     state (never a server-side flip), so a stale client cannot
 *     invert the user's intent. `toggleEmailThreadStar` remains as a
 *     thin wrapper for legacy callers.
 *
 * Label mapping (see gmail-writeback.ts for echo-safety):
 *   star    → add STARRED    unstar    → remove STARRED
 *   archive → remove INBOX   unarchive → add INBOX
 */

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { writebackGmailMessages, writebackGmailThread } from "@/lib/google/gmail-writeback";

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
      messages: { select: { externalId: true } },
    },
  });
}

/** Flip the star from the server's current value. Prefer
 *  `setEmailThreadStarred` - this reads-modifies-writes, so a stale UI
 *  inverts intent. */
export async function toggleEmailThreadStar(
  threadId: string,
): Promise<{ ok: boolean; isStarred?: boolean }> {
  const thread = await findOwnThread(threadId);
  // Not the caller's thread (or nonexistent) — refuse without
  // leaking whether the id exists.
  if (!thread) return { ok: false };
  return applyStar(thread, !thread.isStarred);
}

/** Set the star to an explicit value. Idempotent: the current value
 *  writes nothing. */
export async function setEmailThreadStarred(
  threadId: string,
  starred: boolean,
): Promise<{ ok: boolean; isStarred?: boolean }> {
  const thread = await findOwnThread(threadId);
  if (!thread) return { ok: false };
  if (thread.isStarred === starred) return { ok: true, isStarred: starred };
  return applyStar(thread, starred);
}

async function applyStar(
  thread: NonNullable<Awaited<ReturnType<typeof findOwnThread>>>,
  isStarred: boolean,
): Promise<{ ok: boolean; isStarred?: boolean }> {
  await prisma.emailThread.update({
    where: { id: thread.id },
    data: { isStarred },
  });
  if (thread.externalId) {
    await writebackGmailThread(
      thread.accountId,
      thread.externalId,
      isStarred ? { addLabelIds: ["STARRED"] } : { removeLabelIds: ["STARRED"] },
    );
  }
  revalidateThreadSurfaces(thread.matterId);
  return { ok: true, isStarred };
}

export async function setEmailThreadArchived(
  threadId: string,
  archived: boolean,
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
    // Only the messages the CRM has synced: a thread-level modify
    // would also pull INBOX off a message that reached Gmail after the
    // last sync and that the user has never seen here (F250).
    const syncedIds = thread.messages
      .map((m) => m.externalId)
      .filter((id): id is string => Boolean(id));
    await writebackGmailMessages(
      thread.accountId,
      syncedIds,
      archived ? { removeLabelIds: ["INBOX"] } : { addLabelIds: ["INBOX"] },
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
