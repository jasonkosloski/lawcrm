/**
 * Gmail sync engine (phase 2 of the Gmail integration).
 *
 * Entry points:
 *   - `syncEmailAccount(accountId)` — one account, incremental when a
 *     `historyId` cursor exists, full otherwise.
 *   - `syncEmailAccountsForUser(userId)` — every connected account of
 *     ONE user; the "Sync now" button / server action path.
 *   - `syncAllEmailAccounts()` — every connected account of every
 *     user; the headless cron path (/api/email-sync).
 *   - `maybeKickEmailSync(userId)` — throttled fire-and-forget kick
 *     for the communication page load (see below).
 *
 * Sync strategy
 * -------------
 * Incremental: `users/me/history?startHistoryId=<cursor>` paged to
 * exhaustion; every history record type (messagesAdded, deleted,
 * labelsAdded/Removed) contributes its message's threadId to an
 * affected-set; each affected thread is refetched WHOLE via
 * `users/me/threads/{id}?format=full` and upserted. A 404 from the
 * history endpoint means the cursor expired (Gmail keeps ~a week of
 * history) → transparent fallback to a full sync.
 *
 * Full: `users/me/profile` is read FIRST to capture the new
 * historyId cursor (changes landing during the walk replay on the
 * next incremental — at-least-once, idempotent by upsert), then
 * `users/me/threads` paged with an INITIAL-IMPORT CAP: the newest
 * `FULL_SYNC_MAX_THREADS` threads within `FULL_SYNC_MAX_AGE_DAYS`
 * (the age bound rides the list call as `q=newer_than:Nd`, the
 * count bound stops pagination). The cap keeps a first connect from
 * ingesting a decade of mail; it's a product decision documented in
 * docs/FEATURES.md, deliberately NOT recorded in `syncError` (a
 * benign cap is not an error). Older mail backfill is a follow-up.
 *
 * Idempotency: threads upsert on the (accountId, externalId) unique,
 * messages on (threadId, externalId) — re-running any sync is safe.
 *
 * Provider-owned vs app-owned columns
 * -----------------------------------
 * Re-upserts update ONLY provider-owned columns:
 *   thread: subject, snippet, lastMessageAt, messageCount,
 *           hasAttachments, isRead, isStarred, isArchived
 *   message: from*, to/cc recipients, body, sentAt
 * App-owned state survives every resync: `matterId` (filing),
 * `followUpAt`, spawned notes/tasks/deadlines relations,
 * `EmailMessage.isPrivileged`, and app-vocabulary EmailLabel rows
 * (privileged, opposing_counsel, …). Gmail user labels live in the
 * `custom:*` namespace, which the sync engine owns and reconciles.
 * KNOWN LIMITATION: isRead/isStarred/isArchived treat Gmail as the
 * source of truth, so a thread marked read in-app flips back to
 * unread on resync until read-state writeback ships (follow-up).
 *
 * Attachments: METADATA ONLY (filename, contentType, fileSize, and
 * the Gmail attachmentId stored as `fileUrl: "gmail:<id>"` for the
 * future on-demand bytes fetch). Attachment rows are written once at
 * message create and never touched on re-upsert, so a later
 * downloaded `fileUrl` (real storage URL) survives resyncs.
 *
 * HTML safety: every body passes through `sanitizeEmailHtml` at
 * WRITE time (script/iframe/handler stripping, remote images →
 * "[image blocked]" — see src/lib/sanitize-html.ts). Nothing
 * unsanitized ever lands in `EmailMessage.body`.
 *
 * Failure semantics per account:
 *   - `GmailAuthError` (reconnect required) → account flipped to
 *     syncStatus "error" + syncError, result `{ok:false}` — STOP,
 *     no retry until the user reconnects.
 *   - transient (network / 5xx / rate limit) → syncStatus restored,
 *     syncError records the failure (cleared on next success), and
 *     the error is RETHROWN so direct callers can surface it. The
 *     multi-account wrappers catch it into a per-account result so
 *     one flaky mailbox never blocks the rest.
 *
 * Page-load kick throttle: like the notification sweep, a
 * module-level in-memory per-user timestamp (per server instance;
 * serverless cold starts reset it — a redundant sync is cheap and
 * idempotent). The communication page fires `maybeKickEmailSync`
 * fire-and-forget; it no-ops unless some connected account hasn't
 * synced in `EMAIL_SYNC_KICK_MIN_INTERVAL_MS`.
 */

import { prisma } from "@/lib/prisma";
import { GmailAuthError, gmailFetch } from "@/lib/google/gmail-client";
import { sanitizeEmailHtml } from "@/lib/sanitize-html";
import {
  decodeHtmlEntities,
  decodeMimeWords,
  gmailLabelSlug,
  headerValue,
  isUserLabelId,
  parseGmailMessage,
  threadFlags,
  type GmailMessage,
  type GmailThread,
} from "@/lib/google/gmail-message-parse";

// ── Tuning constants ─────────────────────────────────────────────────────

/** Initial-import cap: at most this many (newest-first) threads. */
export const FULL_SYNC_MAX_THREADS = 200;
/** Initial-import cap: nothing older than this many days
 *  (`q=newer_than:Nd` on the thread list call). */
export const FULL_SYNC_MAX_AGE_DAYS = 90;
/** Gmail history.list page size (500 is the API max). */
const HISTORY_PAGE_SIZE = 500;
/** Gmail threads.list page size during a full sync. */
const THREAD_LIST_PAGE_SIZE = 100;
/** Page-load kick: skip when the user's accounts synced more
 *  recently than this (also the per-user in-memory throttle). */
export const EMAIL_SYNC_KICK_MIN_INTERVAL_MS = 5 * 60 * 1000;

/** Transient sync failure (bad response, unexpected shape). The
 *  account is NOT flipped to error — next attempt retries. */
export class GmailSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailSyncError";
  }
}

export type AccountSyncResult = {
  accountId: string;
  emailAddress: string;
  ok: boolean;
  /** "skipped" = never completed a pass (pre-skipped reconnect-
   *  required account, or a transient failure caught by a wrapper). */
  mode: "incremental" | "full" | "skipped";
  /** Threads written this pass (created or refreshed). */
  threadsSynced: number;
  error?: string;
};

type SyncOutcome = {
  newHistoryId: string | null;
  threadsSynced: number;
};

// ── Gmail API response shapes (subset) ───────────────────────────────────

type HistoryMessageRef = { message?: { id?: string; threadId?: string } };

type GmailHistoryRecord = {
  messages?: Array<{ id?: string; threadId?: string }>;
  messagesAdded?: HistoryMessageRef[];
  messagesDeleted?: HistoryMessageRef[];
  labelsAdded?: HistoryMessageRef[];
  labelsRemoved?: HistoryMessageRef[];
};

type HistoryListResponse = {
  historyId?: string;
  nextPageToken?: string;
  history?: GmailHistoryRecord[];
};

type ThreadListResponse = {
  nextPageToken?: string;
  threads?: Array<{ id: string }>;
};

// ── Single-account sync ──────────────────────────────────────────────────

export async function syncEmailAccount(
  accountId: string
): Promise<AccountSyncResult> {
  const account = await prisma.emailAccount.findUnique({
    where: { id: accountId },
    select: { id: true, emailAddress: true, historyId: true, syncStatus: true },
  });
  if (!account) {
    throw new GmailSyncError("Email account not found.");
  }
  const priorStatus =
    account.syncStatus === "syncing" ? "connected" : account.syncStatus;
  await prisma.emailAccount.update({
    where: { id: accountId },
    data: { syncStatus: "syncing" },
  });

  let mode: "incremental" | "full" = account.historyId
    ? "incremental"
    : "full";
  try {
    const labelMap = await fetchLabelMap(accountId);

    let outcome: SyncOutcome;
    if (account.historyId) {
      const incremental = await runIncrementalSync(
        accountId,
        account.historyId,
        labelMap
      );
      if (incremental === "history-expired") {
        // Cursor aged out at Google — transparent full resync.
        mode = "full";
        outcome = await runFullSync(accountId, labelMap);
      } else {
        outcome = incremental;
      }
    } else {
      outcome = await runFullSync(accountId, labelMap);
    }

    const threadsIndexed = await prisma.emailThread.count({
      where: { accountId },
    });
    await prisma.emailAccount.update({
      where: { id: accountId },
      data: {
        syncStatus: "connected",
        syncError: null,
        lastSyncAt: new Date(),
        historyId: outcome.newHistoryId ?? account.historyId,
        threadsIndexed,
      },
    });
    return {
      accountId,
      emailAddress: account.emailAddress,
      ok: true,
      mode,
      threadsSynced: outcome.threadsSynced,
    };
  } catch (err) {
    if (err instanceof GmailAuthError) {
      // Reconnect required — gmail-client usually already flipped the
      // account; make it unconditional (belt + braces) and STOP.
      await prisma.emailAccount.updateMany({
        where: { id: accountId },
        data: { syncStatus: "error", syncError: err.message },
      });
      return {
        accountId,
        emailAddress: account.emailAddress,
        ok: false,
        mode,
        threadsSynced: 0,
        error: err.message,
      };
    }
    // Transient — restore status, record the failure for
    // /settings/integrations (cleared on next success), rethrow.
    const message =
      err instanceof Error && err.message ? err.message : "Sync failed.";
    await prisma.emailAccount.updateMany({
      where: { id: accountId },
      data: { syncStatus: priorStatus, syncError: `Last sync failed: ${message}` },
    });
    throw err;
  }
}

// ── Incremental path ─────────────────────────────────────────────────────

function collectThreadIds(record: GmailHistoryRecord, into: Set<string>): void {
  for (const m of record.messages ?? []) {
    if (m.threadId) into.add(m.threadId);
  }
  const refLists = [
    record.messagesAdded,
    record.messagesDeleted,
    record.labelsAdded,
    record.labelsRemoved,
  ];
  for (const refs of refLists) {
    for (const ref of refs ?? []) {
      if (ref.message?.threadId) into.add(ref.message.threadId);
    }
  }
}

async function runIncrementalSync(
  accountId: string,
  startHistoryId: string,
  labelMap: Map<string, string>
): Promise<SyncOutcome | "history-expired"> {
  const affected = new Set<string>();
  let newHistoryId: string | null = null;
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      startHistoryId,
      maxResults: String(HISTORY_PAGE_SIZE),
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await gmailFetch(accountId, `/users/me/history?${params}`);
    if (res.status === 404) return "history-expired";
    if (!res.ok) {
      throw new GmailSyncError(`Gmail history list failed (${res.status}).`);
    }
    const data = (await res.json()) as HistoryListResponse;
    if (data.historyId) newHistoryId = String(data.historyId);
    for (const record of data.history ?? []) {
      collectThreadIds(record, affected);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  let threadsSynced = 0;
  for (const threadId of affected) {
    if (await syncOneThread(accountId, threadId, labelMap)) threadsSynced++;
  }
  return { newHistoryId, threadsSynced };
}

// ── Full path ────────────────────────────────────────────────────────────

async function runFullSync(
  accountId: string,
  labelMap: Map<string, string>
): Promise<SyncOutcome> {
  // Cursor FIRST: anything that changes while we walk the list is
  // covered by the next incremental pass (at-least-once + idempotent
  // upserts beats a gap).
  const profileRes = await gmailFetch(accountId, "/users/me/profile");
  if (!profileRes.ok) {
    throw new GmailSyncError(
      `Gmail profile fetch failed (${profileRes.status}).`
    );
  }
  const profile = (await profileRes.json()) as { historyId?: string | number };
  const newHistoryId =
    profile.historyId !== undefined ? String(profile.historyId) : null;

  let threadsSynced = 0;
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      maxResults: String(THREAD_LIST_PAGE_SIZE),
      // Age half of the initial-import cap (see module docstring).
      q: `newer_than:${FULL_SYNC_MAX_AGE_DAYS}d`,
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await gmailFetch(accountId, `/users/me/threads?${params}`);
    if (!res.ok) {
      throw new GmailSyncError(`Gmail thread list failed (${res.status}).`);
    }
    const data = (await res.json()) as ThreadListResponse;
    for (const t of data.threads ?? []) {
      // Count half of the initial-import cap: the list is
      // newest-first, so stopping here keeps the newest N.
      if (threadsSynced >= FULL_SYNC_MAX_THREADS) return { newHistoryId, threadsSynced };
      if (await syncOneThread(accountId, t.id, labelMap)) threadsSynced++;
    }
    pageToken = data.nextPageToken;
  } while (pageToken && threadsSynced < FULL_SYNC_MAX_THREADS);

  return { newHistoryId, threadsSynced };
}

// ── Thread fetch + upsert ────────────────────────────────────────────────

async function fetchLabelMap(
  accountId: string
): Promise<Map<string, string>> {
  const res = await gmailFetch(accountId, "/users/me/labels");
  if (!res.ok) {
    throw new GmailSyncError(`Gmail label list failed (${res.status}).`);
  }
  const data = (await res.json()) as {
    labels?: Array<{ id: string; name: string; type?: string }>;
  };
  return new Map(
    (data.labels ?? [])
      .filter((l) => l.type === "user" || isUserLabelId(l.id))
      .map((l) => [l.id, l.name] as const)
  );
}

/** Fetch one thread `format=full` and upsert it. Returns false when
 *  the thread 404s (deleted upstream) — the LOCAL copy is kept:
 *  filed email is part of the firm's matter record, not a mirror of
 *  the provider's retention choices. */
async function syncOneThread(
  accountId: string,
  externalThreadId: string,
  labelMap: Map<string, string>
): Promise<boolean> {
  const res = await gmailFetch(
    accountId,
    `/users/me/threads/${externalThreadId}?format=full`
  );
  if (res.status === 404) return false;
  if (!res.ok) {
    throw new GmailSyncError(`Gmail thread fetch failed (${res.status}).`);
  }
  const gthread = (await res.json()) as GmailThread;
  await upsertThread(accountId, gthread, labelMap);
  return true;
}

/** Persist one full Gmail thread. Exported for tests. */
export async function upsertThread(
  accountId: string,
  gthread: GmailThread,
  labelMap: Map<string, string>
): Promise<void> {
  const messages: GmailMessage[] = [...(gthread.messages ?? [])].sort(
    (a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0)
  );
  if (messages.length === 0) return;
  const first = messages[0];
  const last = messages[messages.length - 1];

  const subject =
    decodeMimeWords(headerValue(first.payload, "Subject") ?? "").trim() ||
    "(no subject)";
  const snippet = last.snippet ? decodeHtmlEntities(last.snippet) : null;
  const lastMessageAt = new Date(Number(last.internalDate ?? Date.now()));
  const flags = threadFlags(messages);
  const parsed = messages.map(parseGmailMessage);
  const hasAttachments = parsed.some((p) => p.attachments.length > 0);

  // Provider-owned thread columns only — matterId / followUpAt /
  // spawned* relations are app-owned and preserved by omission.
  const providerThreadFields = {
    subject,
    snippet,
    lastMessageAt,
    messageCount: messages.length,
    hasAttachments,
    ...flags,
  };
  const thread = await prisma.emailThread.upsert({
    where: {
      accountId_externalId: { accountId, externalId: gthread.id },
    },
    create: { accountId, externalId: gthread.id, ...providerThreadFields },
    update: providerThreadFields,
    select: { id: true },
  });

  // Label reconciliation — the sync engine owns the `custom:*`
  // namespace (Gmail user labels); app-vocabulary labels
  // (privileged, opposing_counsel, …) are never touched. System +
  // CATEGORY_* label ids never become rows (see gmail-message-parse).
  const desired = new Set<string>();
  for (const m of messages) {
    for (const labelId of m.labelIds ?? []) {
      if (!isUserLabelId(labelId)) continue;
      const name = labelMap.get(labelId);
      if (name) desired.add(gmailLabelSlug(name));
    }
  }
  await prisma.emailLabel.deleteMany({
    where: {
      threadId: thread.id,
      label: { startsWith: "custom:", notIn: [...desired] },
    },
  });
  if (desired.size > 0) {
    await prisma.emailLabel.createMany({
      data: [...desired].map((label) => ({ threadId: thread.id, label })),
      skipDuplicates: true,
    });
  }

  for (const p of parsed) {
    // SANITIZE AT WRITE TIME — the only path into EmailMessage.body.
    const body = sanitizeEmailHtml(p.bodyHtmlRaw);
    const providerMessageFields = {
      fromName: p.from.name || p.from.email,
      fromEmail: p.from.email,
      toRecipients: JSON.stringify(p.to),
      ccRecipients: p.cc.length > 0 ? JSON.stringify(p.cc) : null,
      body,
      sentAt: p.sentAt,
    };
    const existing = await prisma.emailMessage.findUnique({
      where: {
        threadId_externalId: { threadId: thread.id, externalId: p.externalId },
      },
      select: { id: true },
    });
    if (existing) {
      // Provider fields refresh; isPrivileged (app-owned) and the
      // attachment rows (a later download writes a real fileUrl we
      // must not clobber — Gmail attachments are immutable anyway)
      // are left alone.
      await prisma.emailMessage.update({
        where: { id: existing.id },
        data: providerMessageFields,
      });
    } else {
      await prisma.emailMessage.create({
        data: {
          threadId: thread.id,
          externalId: p.externalId,
          ...providerMessageFields,
          attachments: {
            create: p.attachments.map((a) => ({
              filename: a.filename,
              contentType: a.mimeType,
              fileSize: a.size,
              // Gmail attachment id parked in fileUrl under a
              // recognizable scheme until the on-demand bytes fetch
              // ships; a real storage URL replaces it post-download.
              fileUrl: a.attachmentId ? `gmail:${a.attachmentId}` : null,
            })),
          },
        },
      });
    }
  }
}

// ── Multi-account wrappers ───────────────────────────────────────────────

type AccountRow = {
  id: string;
  emailAddress: string;
  syncStatus: string;
  syncError: string | null;
};

async function syncAccounts(
  accounts: AccountRow[]
): Promise<AccountSyncResult[]> {
  const results: AccountSyncResult[] = [];
  for (const account of accounts) {
    if (account.syncStatus === "error") {
      // Reconnect required — hitting Google again just fails.
      results.push({
        accountId: account.id,
        emailAddress: account.emailAddress,
        ok: false,
        mode: "skipped",
        threadsSynced: 0,
        error: account.syncError ?? "Reconnect required.",
      });
      continue;
    }
    try {
      results.push(await syncEmailAccount(account.id));
    } catch (err) {
      // Transient — isolated so one flaky mailbox never blocks the
      // others in this pass.
      results.push({
        accountId: account.id,
        emailAddress: account.emailAddress,
        ok: false,
        mode: "skipped",
        threadsSynced: 0,
        error:
          err instanceof Error && err.message ? err.message : "Sync failed.",
      });
    }
  }
  return results;
}

const CONNECTED_ACCOUNT_SELECT = {
  id: true,
  emailAddress: true,
  syncStatus: true,
  syncError: true,
} as const;

/** Sync every connected account belonging to `userId` (the "Sync
 *  now" / page-kick path). "Connected" = has a refresh token; rows
 *  in the reconnect-required error state are reported, not retried. */
export async function syncEmailAccountsForUser(
  userId: string
): Promise<AccountSyncResult[]> {
  const accounts = await prisma.emailAccount.findMany({
    where: { userId, refreshToken: { not: null } },
    select: CONNECTED_ACCOUNT_SELECT,
    orderBy: { createdAt: "asc" },
  });
  return syncAccounts(accounts);
}

/** Sync every connected account of every user — the headless cron
 *  path. No session involved; each account syncs for its own user. */
export async function syncAllEmailAccounts(): Promise<AccountSyncResult[]> {
  const accounts = await prisma.emailAccount.findMany({
    where: { refreshToken: { not: null } },
    select: CONNECTED_ACCOUNT_SELECT,
    orderBy: { createdAt: "asc" },
  });
  return syncAccounts(accounts);
}

// ── Page-load kick (throttled, fire-and-forget) ──────────────────────────

// Per-instance throttle clock, keyed by user. Same trade-offs as the
// notification sweep's clock (see src/lib/notification-sweeps.ts):
// serverless cold starts reset it, and a redundant sync is cheap +
// idempotent.
const lastKickAtByUser = new Map<string, number>();

/** Test hook — clears the throttle clock between cases. */
export function resetEmailSyncKickThrottleForTests(): void {
  lastKickAtByUser.clear();
}

/**
 * Throttled, non-throwing sync kick for the communication page load.
 * Runs at most once per `EMAIL_SYNC_KICK_MIN_INTERVAL_MS` per user
 * per instance, and only when some connected account actually has a
 * stale (or missing) `lastSyncAt`. Swallows failures with a warn —
 * a broken sync must never take down the inbox page.
 */
export async function maybeKickEmailSync(
  userId: string,
  now: Date = new Date()
): Promise<{ ran: boolean }> {
  const last = lastKickAtByUser.get(userId);
  if (
    last !== undefined &&
    now.getTime() - last < EMAIL_SYNC_KICK_MIN_INTERVAL_MS
  ) {
    return { ran: false };
  }
  // Stamp BEFORE running so concurrent page loads don't stampede.
  lastKickAtByUser.set(userId, now.getTime());
  try {
    const staleCutoff = new Date(
      now.getTime() - EMAIL_SYNC_KICK_MIN_INTERVAL_MS
    );
    const staleAccounts = await prisma.emailAccount.count({
      where: {
        userId,
        refreshToken: { not: null },
        // "syncing" included: a crashed pass shouldn't block kicks
        // forever (its own staleness gate is the lastSyncAt check).
        syncStatus: { in: ["connected", "syncing"] },
        OR: [{ lastSyncAt: null }, { lastSyncAt: { lt: staleCutoff } }],
      },
    });
    if (staleAccounts === 0) return { ran: false };
    await syncEmailAccountsForUser(userId);
    return { ran: true };
  } catch (err) {
    console.warn("[gmail-sync] opportunistic sync failed", err);
    return { ran: true };
  }
}
