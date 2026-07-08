/**
 * Gmail API client helper — THE contract the sync + send layers
 * build on. Server-only (imports prisma; never ship to a client
 * bundle).
 *
 * Two exports matter downstream:
 *
 *   `getGmailAccessToken(accountId, opts?)` → a currently-valid
 *       access token for that EmailAccount, transparently refreshed
 *       via the stored refresh token when expired / near expiry.
 *
 *   `gmailFetch(accountId, path, init?)` → an authenticated fetch
 *       against gmail/v1 with ONE automatic refresh-and-retry on a
 *       401. A thin wrapper — callers own response parsing; this is
 *       deliberately not an SDK surface.
 *
 * Token-expiry storage decision
 * -----------------------------
 * The schema has no `expiresAt` column (and this phase cannot add
 * one), so expiry is stored INSIDE the encrypted `accessToken`
 * column as a JSON envelope:
 *
 *     {"v":1,"token":"ya29...","expiresAt":1767800000000}
 *
 * The ADR-011 Prisma extension encrypts the whole string, so at
 * rest the envelope is as opaque as a bare token; app-side reads
 * hand this module plaintext JSON. Trade-off vs. always-refresh-
 * on-401: we skip a guaranteed wasted round-trip per call once the
 * token ages out, at the cost of a private format inside one
 * column — acceptable because THIS module is the only reader/writer
 * of `accessToken` (sync/send go through `gmailFetch`), and a
 * non-envelope value (never written in practice, but honest about
 * it) degrades safely to "expiry unknown → refresh before use."
 * The 401-retry in `gmailFetch` remains as the safety net for
 * server-side revocation between checks.
 *
 * Failure semantics:
 *   - refresh fails with Google's `invalid_grant` (user revoked in
 *     their Google settings, or the grant lapsed) → the account is
 *     marked `syncStatus: "error"` + `syncError` and a
 *     `GmailAuthError` is thrown. The user must reconnect from
 *     /settings/integrations.
 *   - transient refresh failures (5xx, network) throw
 *     `GoogleOAuthError` WITHOUT flipping account status — the next
 *     sync attempt retries.
 *
 * Concurrency: token refresh is last-writer-wins with no locking.
 * Two overlapping refreshes both obtain valid tokens from Google
 * (Google keeps prior access tokens alive until natural expiry),
 * so whichever envelope persists last still works.
 */

import { prisma } from "@/lib/prisma";
import {
  GoogleOAuthError,
  refreshGoogleAccessToken,
} from "@/lib/google/oauth";

export const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";

/** Refresh this long before nominal expiry — covers clock skew and
 *  the lifetime of one long Gmail API call. */
const EXPIRY_SKEW_MS = 120_000;

const RECONNECT_MESSAGE =
  "Google authorization was revoked or expired. Reconnect this mailbox from Settings → Integrations.";

/** Auth is unrecoverable for this account without user action
 *  (reconnect). Distinct from GoogleOAuthError so sync loops can
 *  stop retrying this account. Message is user-presentable and
 *  never contains token material. */
export class GmailAuthError extends Error {
  constructor(
    message: string,
    readonly accountId: string
  ) {
    super(message);
    this.name = "GmailAuthError";
  }
}

// ── Access-token envelope ────────────────────────────────────────────────

export interface AccessTokenEnvelope {
  token: string;
  /** Epoch ms. 0 = unknown (treat as expired → refresh before use). */
  expiresAt: number;
}

/** Serialize for storage in `EmailAccount.accessToken` (the ADR-011
 *  extension encrypts it on write). Used by the OAuth callback and
 *  the refresh path — every accessToken write goes through this. */
export function serializeAccessToken(
  token: string,
  expiresInSeconds: number,
  now: number = Date.now()
): string {
  return JSON.stringify({
    v: 1,
    token,
    expiresAt: now + expiresInSeconds * 1000,
  });
}

/** Parse a stored (already-decrypted) accessToken column value.
 *  Bare non-envelope strings degrade to `expiresAt: 0` ("unknown,
 *  refresh before use"); null/empty → null. */
export function parseAccessTokenEnvelope(
  stored: string | null
): AccessTokenEnvelope | null {
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as {
      token?: unknown;
      expiresAt?: unknown;
    };
    if (typeof parsed.token === "string" && parsed.token.length > 0) {
      return {
        token: parsed.token,
        expiresAt: typeof parsed.expiresAt === "number" ? parsed.expiresAt : 0,
      };
    }
    return null;
  } catch {
    // Not JSON — a bare token from some out-of-band write. Usable
    // in principle but with unknown expiry; force a refresh.
    return { token: stored, expiresAt: 0 };
  }
}

// ── Token acquisition ────────────────────────────────────────────────────

/**
 * A currently-valid access token for `accountId`.
 *
 * - Returns the stored token when it has >2 minutes of life left.
 * - Otherwise refreshes via the refresh token, persists the rotated
 *   envelope (and rotated refresh token, when Google sends one),
 *   and returns the fresh token.
 * - `opts.forceRefresh` skips the expiry check — used by
 *   `gmailFetch`'s 401 retry when Google says the token is dead
 *   regardless of what our clock thinks.
 *
 * Throws `GmailAuthError` (account needs reconnect — status/
 * syncError already persisted) or `GoogleOAuthError` (transient;
 * retry later, account untouched).
 */
export async function getGmailAccessToken(
  accountId: string,
  opts?: { forceRefresh?: boolean }
): Promise<string> {
  const account = await prisma.emailAccount.findUnique({
    where: { id: accountId },
    select: { id: true, accessToken: true, refreshToken: true },
  });
  if (!account) {
    throw new GmailAuthError(
      "Email account not found — it may have been disconnected.",
      accountId
    );
  }

  const envelope = parseAccessTokenEnvelope(account.accessToken);
  const usable =
    envelope !== null && envelope.expiresAt - EXPIRY_SKEW_MS > Date.now();
  if (usable && !opts?.forceRefresh) return envelope.token;

  if (!account.refreshToken) {
    // No refresh token = disconnected (or a pre-flow row). Not a
    // Google-side failure, so persist the reconnect hint only if
    // there was something that LOOKED connected.
    await markReconnectRequired(accountId);
    throw new GmailAuthError(RECONNECT_MESSAGE, accountId);
  }

  let refreshed;
  try {
    refreshed = await refreshGoogleAccessToken(account.refreshToken);
  } catch (err) {
    if (err instanceof GoogleOAuthError && err.code === "invalid_grant") {
      await markReconnectRequired(accountId);
      throw new GmailAuthError(RECONNECT_MESSAGE, accountId);
    }
    throw err; // transient — leave account status alone
  }

  await prisma.emailAccount.update({
    where: { id: accountId },
    data: {
      accessToken: serializeAccessToken(
        refreshed.access_token,
        refreshed.expires_in
      ),
      // Google rarely rotates refresh tokens on refresh; persist
      // when it does, keep the proven-working one otherwise.
      ...(refreshed.refresh_token
        ? { refreshToken: refreshed.refresh_token }
        : {}),
    },
  });
  return refreshed.access_token;
}

async function markReconnectRequired(accountId: string): Promise<void> {
  // updateMany: no throw if the row vanished mid-flight.
  await prisma.emailAccount.updateMany({
    where: { id: accountId },
    data: { syncStatus: "error", syncError: RECONNECT_MESSAGE },
  });
}

// ── Authenticated fetch ──────────────────────────────────────────────────

/**
 * Authenticated fetch against the Gmail API for `accountId`.
 *
 * `path` is relative to `gmail/v1` (e.g. `/users/me/messages`,
 * `users/me/history?startHistoryId=123`); absolute `https://` URLs
 * pass through for the odd endpoint outside the base (e.g. the
 * upload host). The Authorization header is owned by this wrapper —
 * any caller-supplied one is overwritten.
 *
 * One automatic retry after a forced refresh on 401. A second 401
 * is returned to the caller as-is (by then `getGmailAccessToken`
 * has usually already thrown `GmailAuthError` on `invalid_grant`).
 * Non-401 responses are never retried — rate limits (429/403) are
 * the sync layer's policy call, not this wrapper's.
 */
export async function gmailFetch(
  accountId: string,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const url = path.startsWith("https://")
    ? path
    : `${GMAIL_API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;

  const call = async (token: string): Promise<Response> => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  };

  const first = await call(await getGmailAccessToken(accountId));
  if (first.status !== 401) return first;

  // The token died before its bookkept expiry (revoked server-side,
  // clock skew) — refresh once and retry.
  return call(await getGmailAccessToken(accountId, { forceRefresh: true }));
}
