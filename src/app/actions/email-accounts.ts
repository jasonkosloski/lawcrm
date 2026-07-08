/**
 * Email-account (Gmail integration) mutating actions.
 *
 * One action for now: disconnect. Connecting happens via the OAuth
 * redirect routes (/api/integrations/google/*) — a browser dance
 * that can't be a server action.
 *
 * Auth: identity-scoped, OWNER-ONLY — no permission key and no
 * admin override, deliberately. A connected mailbox is personal
 * OAuth standing between one user and Google (like notification
 * rows or saved searches, the established no-permission-key
 * precedents): another user "managing" it would mean holding the
 * power to sever someone's personal Google grant, which admin
 * governance already covers at the right altitude (deactivate the
 * user). The where-clause carries userId, so a guessed accountId
 * can't touch a colleague's row.
 *
 * Disconnect semantics:
 *   - Best-effort token revocation at Google (refresh token
 *     preferred — revoking it kills the whole grant). A Google
 *     outage never blocks the local disconnect.
 *   - Tokens cleared, syncStatus "disconnected", syncError cleared.
 *   - Threads/messages are KEPT: filed email is part of the firm's
 *     matter record, not an attribute of the OAuth grant. Only the
 *     credential dies. (historyId is also kept so a reconnect can
 *     resume incremental sync; a stale cursor 404s into a full
 *     re-sync by design.)
 */

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { revokeGoogleToken } from "@/lib/google/oauth";
import { parseAccessTokenEnvelope } from "@/lib/google/gmail-client";

export async function disconnectEmailAccount(
  accountId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await getCurrentUserId();

  // Ownership gate — id + userId, so this both authorizes and loads.
  const account = await prisma.emailAccount.findFirst({
    where: { id: accountId, userId },
    select: { id: true, accessToken: true, refreshToken: true },
  });
  if (!account) {
    return { ok: false, error: "Email account not found." };
  }

  // Best-effort revoke (never blocks the disconnect). Revoking
  // either token of a grant revokes the grant; prefer the refresh
  // token since the access token may already be expired.
  const revocable =
    account.refreshToken ??
    parseAccessTokenEnvelope(account.accessToken)?.token ??
    null;
  if (revocable) {
    await revokeGoogleToken(revocable);
  }

  await prisma.emailAccount.update({
    where: { id: account.id },
    data: {
      accessToken: null,
      refreshToken: null,
      syncStatus: "disconnected",
      syncError: null,
    },
  });

  revalidatePath("/settings/integrations");
  return { ok: true };
}
