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
 * Thread vs message scope: `modifyGmailThread` affects EVERY message
 * of the Gmail thread, including ones the CRM hasn't synced yet.
 * Read-state and archive writeback therefore use `writebackGmailMessages`
 * (batchModify over the message ids the CRM actually holds) so a
 * message that landed between syncs keeps its UNREAD label.
 *
 * Label vocabulary used by the actions:
 *   read      → remove UNREAD
 *   star      → add/remove STARRED
 *   archive   → remove INBOX; unarchive → add INBOX
 */

import { prisma } from "@/lib/prisma";
import { GmailAuthError, gmailFetch, recordGmailAuthError } from "@/lib/google/gmail-client";

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
  mods: GmailThreadModification,
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
    },
  );
  if (!res.ok) {
    throw new GmailWritebackError(`Gmail thread modify failed (${res.status}).`);
  }
}

/** `users/me/messages/batchModify` accepts at most 1000 ids. */
const BATCH_MODIFY_MAX_IDS = 1000;

/**
 * Per-MESSAGE label modify: POST `users/me/messages/batchModify`
 * for exactly the given Gmail message ids. This is what read-state
 * writeback uses instead of the thread-level modify — a thread
 * modify applies to EVERY message in the Gmail thread, including
 * ones that arrived after the last sync and that the user has never
 * seen in the CRM (marking those read / archived would hide a new
 * message from opposing counsel). Empty id list or empty
 * modification = no network call. A 400/404 from the batch (a stale
 * id poisons the whole batch) falls back to per-message modify,
 * skipping ids Gmail 404s. Throws on other failures.
 */
export async function modifyGmailMessages(
  accountId: string,
  gmailMessageIds: string[],
  mods: GmailThreadModification,
): Promise<void> {
  const labels: Record<string, string[]> = {};
  if (mods.addLabelIds && mods.addLabelIds.length > 0) {
    labels.addLabelIds = mods.addLabelIds;
  }
  if (mods.removeLabelIds && mods.removeLabelIds.length > 0) {
    labels.removeLabelIds = mods.removeLabelIds;
  }
  const ids = [...new Set(gmailMessageIds)];
  if (ids.length === 0 || Object.keys(labels).length === 0) return;

  for (let i = 0; i < ids.length; i += BATCH_MODIFY_MAX_IDS) {
    const chunk = ids.slice(i, i + BATCH_MODIFY_MAX_IDS);
    const res = await gmailFetch(accountId, "/users/me/messages/batchModify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: chunk, ...labels }),
    });
    if (res.ok) continue;
    if (res.status === 400 || res.status === 404) {
      // Gmail rejects the WHOLE batch when any one id is invalid. Local
      // EmailMessage rows deliberately outlive Gmail-side deletion (and
      // older builds stored draft versions whose ids no longer exist),
      // so one stale id must not make read/archive writeback fail for
      // the thread forever (the next sync would flip it back to
      // unread). Retry message-by-message and skip ids Gmail no longer
      // has.
      await modifyMessagesOneByOne(accountId, chunk, labels);
      continue;
    }
    throw new GmailWritebackError(`Gmail message batchModify failed (${res.status}).`);
  }
}

/** Per-message fallback for `modifyGmailMessages`: POST
 *  `users/me/messages/{id}/modify`. A 404 (message gone) is skipped
 *  per id; any other failure throws. */
async function modifyMessagesOneByOne(
  accountId: string,
  ids: string[],
  labels: Record<string, string[]>,
): Promise<void> {
  for (const id of ids) {
    const res = await gmailFetch(accountId, `/users/me/messages/${encodeURIComponent(id)}/modify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(labels),
    });
    if (res.ok || res.status === 404) continue;
    throw new GmailWritebackError(`Gmail message modify failed (${res.status}).`);
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
  mods: GmailThreadModification,
): Promise<void> {
  await safeWriteback(accountId, "thread modify", () =>
    modifyGmailThread(accountId, gmailThreadId, mods),
  );
}

/** Same never-rejects contract as `writebackGmailThread`, but
 *  scoped to the given message ids (see `modifyGmailMessages`). */
export async function writebackGmailMessages(
  accountId: string,
  gmailMessageIds: string[],
  mods: GmailThreadModification,
): Promise<void> {
  await safeWriteback(accountId, "message batchModify", () =>
    modifyGmailMessages(accountId, gmailMessageIds, mods),
  );
}

async function safeWriteback(
  accountId: string,
  what: string,
  run: () => Promise<void>,
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

    await run();
  } catch (err) {
    if (err instanceof GmailAuthError) {
      // Reconnect required — surface it where the sync engine does
      // (the /settings/integrations card reads syncError). Belt +
      // braces: gmail-client usually already flipped the account.
      await recordGmailAuthError(accountId, err.message, "gmail-writeback");
      return;
    }
    // Transient (network / 5xx / rate limit / DB hiccup) — the local
    // flag is already committed and is the user's intent; Gmail
    // converges on a later writeback or stays behind harmlessly.
    console.warn(`[gmail-writeback] ${what} failed`, err);
  }
}
