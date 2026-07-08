/**
 * Email sync — user-triggered server action.
 *
 * `syncMyEmailAccounts()` syncs every Gmail account the CURRENT
 * user has connected and returns per-account results for the UI
 * ("Sync now" button feedback). It ALSO runs the Google Calendar
 * pull for calendar-scoped accounts (piggybacked here so the
 * existing "Sync now" button covers calendar with zero UI change).
 * Calendar failures are isolated per account inside the pull
 * wrapper AND belt-and-braces here — a broken calendar must never
 * block mail sync; `ok` reflects the EMAIL results only.
 *
 * `backfillMyEmailAccount(accountId)` imports ONE window of older
 * mail (beyond the capped initial import) for one of the current
 * user's own accounts — the "Load older emails" button on the
 * /settings/integrations Gmail card. Each click extends one window
 * (`BACKFILL_MAX_THREADS` threads) further back; see
 * `backfillEmailAccount` in gmail-sync.ts for the windowing design.
 *
 * Auth: identity-scoped, session-only — no permission key, matching
 * the `disconnectEmailAccount` precedent (a connected mailbox is
 * personal OAuth standing between one user and Google; there is no
 * "sync someone else's mailbox" capability to gate). The backfill
 * action additionally verifies the accountId belongs to the caller
 * before touching Google. The headless all-accounts path lives at
 * /api/email-sync behind CRON_SECRET.
 */

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import {
  backfillEmailAccount,
  syncEmailAccountsForUser,
  type AccountSyncResult,
} from "@/lib/google/gmail-sync";
import {
  pullCalendarForUserAccounts,
  type CalendarPullResult,
} from "@/lib/google/google-calendar-sync";

export async function syncMyEmailAccounts(): Promise<{
  ok: boolean;
  results: AccountSyncResult[];
  calendar: CalendarPullResult[];
}> {
  const userId = await getCurrentUserId();
  const results = await syncEmailAccountsForUser(userId);

  // Calendar pull rides the same trigger. Isolated: the wrapper
  // already catches per-account failures into results, and this
  // catch keeps even an infrastructure-level calendar blowup from
  // eating the mail results the user asked for.
  let calendar: CalendarPullResult[] = [];
  try {
    calendar = await pullCalendarForUserAccounts(userId);
  } catch (err) {
    console.warn("[email-sync] calendar pull failed", err);
  }

  // Anything synced (or even attempted) can change thread lists,
  // unread counts, and the integrations card's lastSyncAt/syncError.
  if (results.length > 0) {
    revalidatePath("/communication");
    revalidatePath("/settings/integrations");
  }
  if (calendar.some((c) => c.mode !== "skipped")) {
    revalidatePath("/calendar");
  }

  // `ok` is the EMAIL verdict — the Sync-now button's contract
  // predates calendar and stays about mail; calendar outcomes ride
  // alongside for future UI.
  return { ok: results.every((r) => r.ok), results, calendar };
}

export async function backfillMyEmailAccount(accountId: string): Promise<{
  ok: boolean;
  /** New (previously un-imported) threads this window brought in. */
  threadsSynced: number;
  error?: string;
}> {
  const userId = await getCurrentUserId();

  // Owner scoping BEFORE any Google traffic — another user's
  // accountId (or a bogus one) reads as not-found.
  const account = await prisma.emailAccount.findFirst({
    where: { id: accountId, userId },
    select: { id: true },
  });
  if (!account) {
    return { ok: false, threadsSynced: 0, error: "Email account not found." };
  }

  try {
    const result = await backfillEmailAccount(accountId);
    // New threads land in the inbox lists; the card's thread count /
    // oldest-thread date move either way.
    revalidatePath("/communication");
    revalidatePath("/settings/integrations");
    return {
      ok: result.ok,
      threadsSynced: result.threadsSynced,
      ...(result.error ? { error: result.error } : {}),
    };
  } catch (err) {
    // Transient (rethrown by the engine, syncError already noted) —
    // surface it to the button instead of blowing up the page.
    revalidatePath("/settings/integrations");
    return {
      ok: false,
      threadsSynced: 0,
      error:
        err instanceof Error && err.message ? err.message : "Backfill failed.",
    };
  }
}
