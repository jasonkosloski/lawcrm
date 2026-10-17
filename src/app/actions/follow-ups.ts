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
import { parseDateOnly } from "@/lib/format-date";

export async function setEmailThreadFollowUp(
  threadId: string,
  /** Date string in `YYYY-MM-DD` form, or null to clear. Stored as
   *  end-of-day in the SERVER's zone (UTC in production) so a "follow
   *  up by Friday" doesn't expire at midnight that morning. The
   *  dashboard compares against the same server-local end-of-day, so
   *  the two stay consistent. */
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
 *  day (23:59:59.999, server-local - see the field comment above) so a
 *  follow-up "by Friday" stays active all of Friday. Returns null on
 *  parse failure, an impossible date (2026-02-30) or empty input. */
function parseEndOfDay(dateString: string | null): Date | null {
  if (!dateString) return null;
  // parseDateOnly validates the calendar date (rejects Feb 30 instead of
  // rolling it into March); its UTC components are the intended Y/M/D.
  const day = parseDateOnly(dateString);
  if (!day) return null;
  return new Date(
    day.getUTCFullYear(),
    day.getUTCMonth(),
    day.getUTCDate(),
    23,
    59,
    59,
    999
  );
}
