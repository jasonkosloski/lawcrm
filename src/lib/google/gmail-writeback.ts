/**
 * Gmail writeback (Email v1.1) — pushes CRM-side thread flag changes
 * (read / star / archive) back to Gmail so the two inboxes agree.
 *
 * Before this module, `isRead`/`isStarred`/`isArchived` were synced
 * ONE WAY (Gmail → CRM): marking a thread read in the CRM left it
 * unread at Gmail, and the next resync flipped the local flag back —
 * the "double inbox" problem. Writeback closes the loop: the local
 * mutation commits first (local state is the user's intent), then a
 * label modify is pushed to Gmail so the provider catches up.
 *
 * Two exports:
 *
 *   `modifyGmailThread(accountId, gmailThreadId, mods)` — the raw
 *       call: POST `users/me/threads/{id}/modify` with
 *       `{addLabelIds, removeLabelIds}`. Throws (`GmailAuthError`
 *       from the client layer, `GmailWritebackError` on non-2xx) —
 *       use it when the caller wants to handle failure itself.
 *
 *   `writebackGmailThread(...)` — the fire-and-forget-safe wrapper
 *       every server action uses. NEVER rejects and never breaks the
 *       local mutation:
 *         - account has no refresh token (disconnected / pre-flow) →
 *           silent skip. Important: calling through `gmailFetch`
 *           would flip a deliberately-disconnected account into the
 *           reconnect-required error state — a flag nicety must not
 *           do that.
 *         - `GmailAuthError` (grant revoked) → recorded on
 *           `account.syncError` (+ `syncStatus: "error"`), the same
 *           reconnect signal the sync engine raises.
 *         - anything transient (network, 5xx, rate limit) →
 *           `console.warn` and move on; the flag stays correct
 *           locally and Gmail simply lags until the user acts again
 *           or reads the thread there.
 *
 * Echo safety (why writeback → resync can't loop)
 * -----------------------------------------------
 * The sync engine derives `isRead`/`isStarred`/`isArchived` from
 * Gmail's labels and upserts idempotently — after a writeback, the
 * next sync re-reads labels that now MATCH the local flags, so the
 * upsert is a no-op on those columns. Nothing in the sync path
 * triggers writeback (only user-initiated server actions do), so
 * there is no cycle: user intent → local flag → Gmail label →
 * (resync) → same local flag. Converged.
 *
 * Label vocabulary used by the actions:
 *   read      → remove UNREAD
 *   star      → add/remove STARRED
 *   archive   → remove INBOX; unarchive → add INBOX
 */

import { prisma } from "@/lib/prisma";
import { GmailAuthError, gmailFetch } from "@/lib/google/gmail-client";

export type GmailThreadModification = {
  addLabelIds?: string[];
  removeLabelIds?: string[];
};

/** Non-2xx from the modify endpoint (auth failures are the client
 *  layer's `GmailAuthError` instead). Transient by assumption. */
export class GmailWritebackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailWritebackError";
  }
}

/**
 * Raw label modify: POST `users/me/threads/{id}/modify`. Empty
 * modifications no-op without a network call. Throws on failure —
 * see `writebackGmailThread` for the swallowing wrapper.
 */
export async function modifyGmailThread(
  accountId: string,
  gmailThreadId: string,
  mods: GmailThreadModification
): Promise<void> {
  const body: Record<string, string[]> = {};
  if (mods.addLabelIds && mods.addLabelIds.length > 0) {
    body.addLabelIds = mods.addLabelIds;
  }
  if (mods.removeLabelIds && mods.removeLabelIds.length > 0) {
    body.removeLabelIds = mods.removeLabelIds;
  }
  if (Object.keys(body).length === 0) return;

  const res = await gmailFetch(
    accountId,
    `/users/me/threads/${encodeURIComponent(gmailThreadId)}/modify`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    throw new GmailWritebackError(
      `Gmail thread modify failed (${res.status}).`
    );
  }
}

/**
 * Fire-and-forget-safe writeback. NEVER rejects (safe to `await`
 * inline after the local write, or to `void` off). See the module
 * docstring for the full failure contract.
 */
export async function writebackGmailThread(
  accountId: string,
  gmailThreadId: string,
  mods: GmailThreadModification
): Promise<void> {
  try {
    const account = await prisma.emailAccount.findUnique({
      where: { id: accountId },
      select: { refreshToken: true },
    });
    // No token = disconnected (or a pre-OAuth row). Skip silently —
    // going through gmailFetch would mark the account
    // reconnect-required, which a flag toggle has no business doing.
    if (!account?.refreshToken) return;

    await modifyGmailThread(accountId, gmailThreadId, mods);
  } catch (err) {
    if (err instanceof GmailAuthError) {
      // Reconnect required — surface it where the sync engine does
      // (the /settings/integrations card reads syncError). Belt +
      // braces: gmail-client usually already flipped the account.
      await prisma.emailAccount
        .updateMany({
          where: { id: accountId },
          data: { syncStatus: "error", syncError: err.message },
        })
        .catch((persistErr) => {
          console.warn(
            "[gmail-writeback] failed to record auth error",
            persistErr
          );
        });
      return;
    }
    // Transient (network / 5xx / rate limit / DB hiccup) — the local
    // flag is already committed and is the user's intent; Gmail
    // converges on a later writeback or stays behind harmlessly.
    console.warn("[gmail-writeback] thread modify failed", err);
  }
}
