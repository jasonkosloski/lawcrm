/**
 * Email sync — user-triggered server action.
 *
 * `syncMyEmailAccounts()` syncs every Gmail account the CURRENT
 * user has connected and returns per-account results for the UI
 * ("Sync now" button feedback).
 *
 * Auth: identity-scoped, session-only — no permission key, matching
 * the `disconnectEmailAccount` precedent (a connected mailbox is
 * personal OAuth standing between one user and Google; there is no
 * "sync someone else's mailbox" capability to gate). The headless
 * all-accounts path lives at /api/email-sync behind CRON_SECRET.
 */

"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/current-user";
import {
  syncEmailAccountsForUser,
  type AccountSyncResult,
} from "@/lib/google/gmail-sync";

export async function syncMyEmailAccounts(): Promise<{
  ok: boolean;
  results: AccountSyncResult[];
}> {
  const userId = await getCurrentUserId();
  const results = await syncEmailAccountsForUser(userId);

  // Anything synced (or even attempted) can change thread lists,
  // unread counts, and the integrations card's lastSyncAt/syncError.
  if (results.length > 0) {
    revalidatePath("/communication");
    revalidatePath("/settings/integrations");
  }

  return { ok: results.every((r) => r.ok), results };
}
