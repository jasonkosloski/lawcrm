/**
 * Follow-up snooze server actions for email + messenger threads.
 *
 * Pass `null` to clear the snooze, or an ISO date string to set it.
 * Idempotent — re-snoozing to the same value is harmless.
 *
 * Notifications themselves wait on Phase 8; this just persists the
 * intent + revalidates the surfaces that surface it (the thread
 * reader chip, the thread list row chip, and the dashboard "Follow
 * up today" card).
 *
 * Access: follow-up is part of mailbox access (like read/star/file),
 * so there's no separate permission key. Email threads are scoped to
 * the caller's own connected mailboxes via `account: { userId }` —
 * the same filter the thread readers use (getThreadById). Messenger
 * lines can be firm-shared (MessengerAccount.userId is nullable) and
 * the messenger readers are firm-wide, so there the session check is
 * the gate.
 */

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";

export async function setEmailThreadFollowUp(
  threadId: string,
  /** Date string in `YYYY-MM-DD` form, or null to clear. Stored as
   *  end-of-day in the user's locale so a "follow up by Friday"
   *  doesn't expire at midnight that morning. */
  dateString: string | null
): Promise<{ ok: boolean; error?: string }> {
  const userId = await getCurrentUserId();
  const followUpAt = parseEndOfDay(dateString);
  if (dateString && !followUpAt) {
    return { ok: false, error: "Invalid date" };
  }

  // Scoped to the caller's own mailboxes — a thread in someone
  // else's account is indistinguishable from a nonexistent one.
  const thread = await prisma.emailThread.findFirst({
    where: { id: threadId, account: { userId } },
    select: { matterId: true },
  });
  if (!thread) return { ok: false, error: "Thread not found" };

  await prisma.emailThread.update({
    where: { id: threadId },
    data: { followUpAt },
  });

  revalidatePath("/communication");
  revalidatePath("/"); // dashboard "Follow up today"
  if (thread.matterId) {
    revalidatePath(`/matters/${thread.matterId}/communication`);
  }
  return { ok: true };
}

export async function setMessengerThreadFollowUp(
  threadId: string,
  dateString: string | null
): Promise<{ ok: boolean; error?: string }> {
  // Messenger inbox is firm-wide (see module header) — session
  // check only, no per-account scoping to mirror.
  await getCurrentUserId();
  const followUpAt = parseEndOfDay(dateString);
  if (dateString && !followUpAt) {
    return { ok: false, error: "Invalid date" };
  }

  const thread = await prisma.messengerThread.findUnique({
    where: { id: threadId },
    select: { defaultMatterId: true },
  });
  if (!thread) return { ok: false, error: "Thread not found" };

  await prisma.messengerThread.update({
    where: { id: threadId },
    data: { followUpAt },
  });

  revalidatePath("/communication");
  revalidatePath("/"); // dashboard "Follow up today"
  if (thread.defaultMatterId) {
    revalidatePath(`/matters/${thread.defaultMatterId}/communication`);
  }
  return { ok: true };
}

/** Convert a `YYYY-MM-DD` date string to a Date at the END of that
 *  day (23:59:59.999) so a follow-up "by Friday" stays active all of
 *  Friday. Returns null on parse failure or empty input. */
function parseEndOfDay(dateString: string | null): Date | null {
  if (!dateString) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), 23, 59, 59, 999);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}
