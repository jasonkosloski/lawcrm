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
 *   - `backfillEmailAccount(accountId)` — one WINDOW of older mail
 *     beyond what the capped initial import brought in (the "Load
 *     older emails" button on /settings/integrations; see the
 *     backfill section below).
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
 * docs/features/communication-email.md, deliberately NOT recorded in `syncError` (a
 * benign cap is not an error). Older mail is fetched on demand via
 * `backfillEmailAccount` (below), one capped window per call.
 *
 * Hardening (W6a):
 *   - History-expired fallback for an account that has synced before
 *     is an UNCAPPED catch-up (`q=after:<lastSyncAt - 1d>`, safety cap
 *     `CATCHUP_MAX_THREADS`); only a first import is capped at 200/90d.
 *   - A catch-up that hits the safety cap does NOT advance the cursor
 *     or lastSyncAt (so the gap is re-listed next pass) and notes it in
 *     syncError; catch-up threads already current locally are skipped
 *     after a `format=minimal` check, so each pass reaches further.
 *   - Per-thread failure isolation only covers DETERMINISTIC data
 *     errors. Auth, transport and transient database errors (see
 *     transient-error.ts) abort the pass with the cursor untouched, as
 *     does a pass where several threads all failed.
 *   - Incremental sync never imports an UNKNOWN thread whose last
 *     message is older than the oldest local thread (the backfill
 *     anchor) — label-only history records on ancient mail would drag
 *     the anchor back and strand everything in between.
 *   - DRAFT messages are never stored (local copies are removed); NUL
 *     bytes are stripped from every persisted string; one thread whose
 *     import throws is logged + skipped (surfaced via syncError) so it
 *     can't wedge the mailbox. Deactivated owners' accounts don't sync.
 *   - SPAM / TRASH: history.list reports changes on every label, so an
 *     incremental pass sees junk the full sync's thread list hides. A
 *     thread whose every message is SPAM/TRASH is never IMPORTED, and an
 *     already-local one is kept (filed mail is a firm record) but forced
 *     read + archived so it can't inflate unread counts. A restore
 *     (labelsAdded INBOX) arrives as a history record and imports
 *     normally.
 *   - Per-account claim: `syncEmailAccount` claims the account with a
 *     compare-and-set on syncStatus (a stale claim expires after
 *     `SYNC_CLAIM_STALE_MS`), so the cron, "Sync now", the page kick and
 *     a long first import don't run the same mailbox twice; the loser
 *     returns mode "skipped". Message inserts also tolerate the unique
 *     race (P2002 → update) for the backfill, which isn't claimed.
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
 * App-owned state survives every resync: `matterId` / `leadId` (filing),
 * `followUpAt`, spawned notes/tasks/deadlines relations,
 * `EmailMessage.isPrivileged` / `sentFromApp`, and app-vocabulary EmailLabel rows
 * (privileged, opposing_counsel, …). Gmail user labels live in the
 * `custom:*` namespace, which the sync engine owns and reconciles.
 * isRead/isStarred/isArchived stay PROVIDER-DERIVED here — and
 * that's now correct rather than a limitation, because in-app flag
 * changes write back to Gmail's labels (`gmail-writeback.ts`:
 * mark-read removes UNREAD, star adds/removes STARRED, archive
 * removes/adds INBOX). Gmail reflects CRM intent shortly after the
 * local mutation, so the label-derived flags this sync computes
 * converge on the same values instead of reverting them; and since
 * sync never triggers writeback, there is no echo loop.
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
import { stripNul, stripNulOrNull } from "@/lib/google/strip-nul";
import { isTransientInfraError } from "@/lib/google/transient-error";
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
/** Backfill cap: at most this many threads imported per
 *  `backfillEmailAccount` call (one "Load older emails" click). */
export const BACKFILL_MAX_THREADS = 200;
/** History-expired catch-up cap (threads imported newer than the
 *  last good sync). Far above the initial-import cap on purpose: the
 *  catch-up must close the whole gap, since "Load older emails" only
 *  walks BELOW the oldest local thread and can never reach it. */
export const CATCHUP_MAX_THREADS = 1000;
/** A "syncing" claim older than this is treated as a crashed run and
 *  may be re-claimed. Above the 300 s function ceiling so a live run
 *  is never stolen from. */
export const SYNC_CLAIM_STALE_MS = 10 * 60 * 1000;
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
   *  required account, a transient failure caught by a wrapper, or
   *  another sync already holds the account — `ok` stays true then). */
  mode: "incremental" | "full" | "skipped";
  /** Threads written this pass (created or refreshed). */
  threadsSynced: number;
  /** Threads whose import threw and were skipped this pass (ids are
   *  logged at error level at the catch site and noted on syncError).
   *  Surfaced so the cron response can report them. */
  failedThreads?: number;
  /** The pass threw (not a reconnect/skip decision) — the cron
   *  route reports these as a failed run so they get noticed. */
  transient?: true;
  error?: string;
};

type SyncOutcome = {
  newHistoryId: string | null;
  threadsSynced: number;
  /** Threads whose import threw (data the database rejected, a
   *  malformed payload) and were skipped so the rest of the pass —
   *  and the history cursor — could still move. */
  failedThreads: number;
  /** First few failed thread ids (ids only, never content) for the
   *  operator-visible syncError note. */
  failedThreadIds: string[];
  /** Catch-up stopped at its safety cap with mail still unlisted:
   *  the cursor and lastSyncAt must NOT advance (see runFullSync). */
  truncated: boolean;
};

/** Per-pass context threaded into `syncOneThread`. */
type ThreadPassContext = {
  /** Gmail thread ids whose import threw this pass. */
  failed: string[];
  /** Threads whose import completed without throwing (written OR
   *  legitimately skipped). Drives the "everything failed" guard. */
  ok: number;
  /** Catch-up only: check each thread with a cheap `format=minimal`
   *  fetch first and skip the full fetch + upsert when the local copy
   *  already matches (message count, last message time, flags). Makes
   *  a re-run of an interrupted catch-up cheap and lets it progress
   *  past what an earlier attempt already imported. */
  skipUnchanged?: boolean;
  /** Incremental only: skip UNKNOWN threads whose last message is
   *  older than this (see `upsertThread`'s `skipUnknownBefore`). */
  skipUnknownBefore?: Date | null;
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

/** The operator-visible note for a pass that completed but did not do
 *  everything: truncated catch-up and/or skipped (poisoned) threads.
 *  Thread ids only — never content. Null = clean pass. */
function syncNote(outcome: SyncOutcome): string | null {
  const parts: string[] = [];
  if (outcome.truncated) {
    parts.push(
      `Catch-up after expired Gmail history hit its per-pass thread safety cap; it will continue on the next sync.`
    );
  }
  if (outcome.failedThreads > 0) {
    const ids = outcome.failedThreadIds.join(", ");
    parts.push(
      `${outcome.failedThreads} thread(s) could not be imported and were skipped (${ids}${
        outcome.failedThreads > outcome.failedThreadIds.length ? ", …" : ""
      }).`
    );
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

export async function syncEmailAccount(
  accountId: string,
  opts?: {
    /** Test seam: override the catch-up safety cap. */
    catchUpMaxThreads?: number;
    /** Test seam: override FULL_SYNC_MAX_THREADS (initial-import cap). */
    fullSyncMaxThreads?: number;
  }
): Promise<AccountSyncResult> {
  const account = await prisma.emailAccount.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      emailAddress: true,
      historyId: true,
      lastSyncAt: true,
      syncStatus: true,
      refreshToken: true,
      user: { select: { isActive: true } },
    },
  });
  if (!account) {
    throw new GmailSyncError("Email account not found.");
  }
  if (!account.refreshToken) {
    // Disconnected (credentials cleared): nothing to sync with, and
    // the deliberate "disconnected" status must survive — never claim,
    // never relabel it.
    return {
      accountId,
      emailAddress: account.emailAddress,
      ok: false,
      mode: "skipped",
      threadsSynced: 0,
      error: "Mailbox is disconnected.",
    };
  }
  if (!account.user.isActive) {
    // A deactivated member's mailbox stops syncing everywhere (cron
    // AND on-demand) — no Google traffic, account state untouched so
    // a reactivation resumes cleanly.
    return {
      accountId,
      emailAddress: account.emailAddress,
      ok: false,
      mode: "skipped",
      threadsSynced: 0,
      error: "Account owner is deactivated.",
    };
  }
  const priorStatus =
    account.syncStatus === "syncing" ? "connected" : account.syncStatus;
  // Claim the account atomically. Another pass already syncing it
  // (cron vs "Sync now" vs the page kick) means this one has nothing
  // to add — the second pass would redo the same work and race the
  // message inserts. A claim older than SYNC_CLAIM_STALE_MS is a
  // crashed run and is taken over. The claim also requires a refresh
  // token and a non-"disconnected" status, so a disconnect landing
  // between the caller's account listing and this claim is not
  // stomped back to "syncing".
  const claim = await prisma.emailAccount.updateMany({
    where: {
      id: accountId,
      refreshToken: { not: null },
      syncStatus: { not: "disconnected" },
      OR: [
        { syncStatus: { not: "syncing" } },
        { updatedAt: { lt: new Date(Date.now() - SYNC_CLAIM_STALE_MS) } },
      ],
    },
    data: { syncStatus: "syncing" },
  });
  if (claim.count === 0) {
    return {
      accountId,
      emailAddress: account.emailAddress,
      ok: true,
      mode: "skipped",
      threadsSynced: 0,
    };
  }

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
        // Cursor aged out at Google — transparent full resync. With a
        // prior successful sync the pass is an UNCAPPED catch-up from
        // that point (the 200-thread initial-import cap would leave a
        // gap backfill can never reach); without one it's the normal
        // capped first import.
        mode = "full";
        outcome = await runFullSync(
          accountId,
          labelMap,
          account.lastSyncAt ?? undefined,
          opts?.catchUpMaxThreads,
          opts?.fullSyncMaxThreads
        );
      } else {
        outcome = incremental;
      }
    } else {
      outcome = await runFullSync(
        accountId,
        labelMap,
        undefined,
        undefined,
        opts?.fullSyncMaxThreads
      );
    }

    const threadsIndexed = await prisma.emailThread.count({
      where: { accountId },
    });
    // Guarded: a disconnect during a long pass (token cleared, status
    // "disconnected") must not be resurrected as "connected".
    await prisma.emailAccount.updateMany({
      where: {
        id: accountId,
        refreshToken: { not: null },
        syncStatus: { not: "disconnected" },
      },
      data: {
        syncStatus: "connected",
        // Skipped threads and a truncated catch-up stay visible
        // (cleared by the next clean pass) — never silently dropped.
        syncError: syncNote(outcome),
        // A truncated catch-up leaves BOTH the (expired) cursor and
        // lastSyncAt alone: the next pass must re-list the same
        // window, not start from "now" and strand the unlisted part.
        ...(outcome.truncated
          ? {}
          : {
              lastSyncAt: new Date(),
              historyId: outcome.newHistoryId ?? account.historyId,
            }),
        threadsIndexed,
      },
    });
    return {
      accountId,
      emailAddress: account.emailAddress,
      ok: true,
      mode,
      threadsSynced: outcome.threadsSynced,
      failedThreads: outcome.failedThreads,
    };
  } catch (err) {
    if (err instanceof GmailAuthError) {
      // Reconnect required — gmail-client usually already flipped the
      // account; make it unconditional (belt + braces) and STOP. Never
      // relabel a deliberately disconnected mailbox.
      await prisma.emailAccount.updateMany({
        where: { id: accountId, syncStatus: { not: "disconnected" } },
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
      where: { id: accountId, syncStatus: { not: "disconnected" } },
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

  const frontier = await prisma.emailThread.aggregate({
    where: { accountId },
    _min: { lastMessageAt: true },
  });
  // Backfill anchors on the oldest local thread. A label-only history
  // record on an OLD thread we never imported (read/star/trash a 2019
  // email) must not pull that thread in and drag the anchor back
  // years — everything between would be unreachable. Unknown threads
  // older than the current frontier belong to backfill; known threads
  // and anything newer sync normally.
  const ctx: ThreadPassContext = {
    failed: [],
    ok: 0,
    skipUnknownBefore: frontier._min.lastMessageAt,
  };
  let threadsSynced = 0;
  for (const threadId of affected) {
    if (await syncOneThread(accountId, threadId, labelMap, ctx)) threadsSynced++;
  }
  assertNotAllFailed(ctx);
  return {
    newHistoryId,
    threadsSynced,
    failedThreads: ctx.failed.length,
    failedThreadIds: ctx.failed.slice(0, 5),
    truncated: false,
  };
}

// ── Full path ────────────────────────────────────────────────────────────

/**
 * Full list walk. `catchUpSince` set = the history-expired fallback
 * for an account that HAS synced before: list everything since a day
 * before that point under the large `CATCHUP_MAX_THREADS` safety cap
 * (a gap here is unrecoverable — backfill only walks below the
 * oldest local thread). Unset = the capped initial import.
 */
async function runFullSync(
  accountId: string,
  labelMap: Map<string, string>,
  catchUpSince?: Date,
  catchUpMaxThreads?: number,
  fullSyncMaxThreads?: number
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

  const cap = catchUpSince
    ? (catchUpMaxThreads ?? CATCHUP_MAX_THREADS)
    : (fullSyncMaxThreads ?? FULL_SYNC_MAX_THREADS);
  // Age half of the cap. Initial import: relative `newer_than`.
  // Catch-up: absolute `after:<epoch s>`, a day of slack before the
  // last good sync so clock skew / in-flight mail can't open a gap.
  const q = catchUpSince
    ? `after:${Math.max(0, Math.floor(catchUpSince.getTime() / 1000) - 86400)}`
    : `newer_than:${FULL_SYNC_MAX_AGE_DAYS}d`;

  const ctx: ThreadPassContext = {
    failed: [],
    ok: 0,
    skipUnchanged: Boolean(catchUpSince),
  };
  const finish = (threadsSynced: number, truncated: boolean): SyncOutcome => {
    assertNotAllFailed(ctx);
    // Only a CATCH-UP truncation is a problem (the initial import is
    // capped by design). The caller keeps the stale cursor and the old
    // lastSyncAt so the next pass re-lists the same window; threads
    // already imported are skipped cheaply (`skipUnchanged`), so each
    // pass reaches further back until the gap is closed.
    const catchUpTruncated = truncated && Boolean(catchUpSince);
    if (catchUpTruncated) {
      console.warn(
        `[gmail-sync] catch-up for account ${accountId} stopped at the ${cap}-thread safety cap; will continue next sync`
      );
    }
    return {
      newHistoryId,
      threadsSynced,
      failedThreads: ctx.failed.length,
      failedThreadIds: ctx.failed.slice(0, 5),
      truncated: catchUpTruncated,
    };
  };

  let threadsSynced = 0;
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      maxResults: String(THREAD_LIST_PAGE_SIZE),
      q,
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await gmailFetch(accountId, `/users/me/threads?${params}`);
    if (!res.ok) {
      throw new GmailSyncError(`Gmail thread list failed (${res.status}).`);
    }
    const data = (await res.json()) as ThreadListResponse;
    for (const t of data.threads ?? []) {
      // Count half of the cap: the list is newest-first, so
      // stopping here keeps the newest N.
      if (threadsSynced >= cap) return finish(threadsSynced, true);
      if (await syncOneThread(accountId, t.id, labelMap, ctx)) threadsSynced++;
    }
    pageToken = data.nextPageToken;
  } while (pageToken && threadsSynced < cap);

  return finish(threadsSynced, Boolean(pageToken));
}

// ── Older-mail backfill ──────────────────────────────────────────────────

export type BackfillResult = {
  accountId: string;
  emailAddress: string;
  ok: boolean;
  /** NEW threads imported this window (existing ones don't count). */
  threadsSynced: number;
  /** Upper bound of the window walked — the oldest local thread's
   *  lastMessageAt at call time. Null = mailbox has no local threads
   *  yet (run a sync first; the initial import owns that window). */
  before: Date | null;
  error?: string;
};

/**
 * Import ONE window of mail older than everything already local.
 *
 * Windowing (honest against Gmail query semantics): Gmail's
 * `before:`/`after:` operators accept epoch SECONDS, and
 * `newer_than:Nd` is always relative to NOW — so an anchored
 * "90 days ending at X" window can't be expressed with newer_than.
 * The simplest correct design is a pure upper bound: list threads
 * with `q=before:<oldest local lastMessageAt, rounded UP to the next
 * second>` (round up so sub-second truncation can never skip mail;
 * the anchor thread re-matching is harmless — upserts are
 * idempotent). Gmail returns matches newest-first, so walking the
 * list with a `BACKFILL_MAX_THREADS` cap yields exactly the next
 * `N` threads older than the anchor.
 *
 * Cap stacking: each call re-anchors at the CURRENT oldest local
 * thread, so repeated calls walk successively older windows —
 * clicking "Load older emails" k times reaches ~k×200 threads back.
 * Already-local threads returned by the query (boundary overlap,
 * or a prior partial window) are skipped WITHOUT consuming the cap
 * or a thread fetch.
 *
 * Deliberately outside the sync status machine: `historyId` (the
 * incremental cursor), `syncStatus`, and `lastSyncAt` are never
 * touched — backfill extends history; sync owns the present.
 * `threadsIndexed` is refreshed since the card displays it.
 *
 * Failure semantics mirror `syncEmailAccount`: `GmailAuthError` →
 * account flipped to error + `ok:false`; transient → `syncError`
 * noted and the error RETHROWN for the caller (the server action
 * catches it into `{ok:false}`).
 */
export async function backfillEmailAccount(
  accountId: string,
  opts?: { maxThreads?: number }
): Promise<BackfillResult> {
  const account = await prisma.emailAccount.findUnique({
    where: { id: accountId },
    select: { id: true, emailAddress: true },
  });
  if (!account) {
    throw new GmailSyncError("Email account not found.");
  }

  const oldest = await prisma.emailThread.findFirst({
    where: { accountId },
    orderBy: { lastMessageAt: "asc" },
    select: { lastMessageAt: true },
  });
  if (!oldest) {
    // Nothing local to anchor on — the initial (capped) sync owns
    // the first window. Not an error; the UI hides the button.
    return {
      accountId,
      emailAddress: account.emailAddress,
      ok: true,
      threadsSynced: 0,
      before: null,
    };
  }

  const before = oldest.lastMessageAt;
  // Round UP: `before:` is second-granular and we must not lose the
  // sub-second remainder (missing mail is worse than re-walking the
  // anchor thread, which the existing-set skip below handles).
  const beforeSeconds = Math.ceil(before.getTime() / 1000);
  const cap = opts?.maxThreads ?? BACKFILL_MAX_THREADS;

  try {
    const labelMap = await fetchLabelMap(accountId);
    let threadsSynced = 0;
    const passCtx: ThreadPassContext = { failed: [], ok: 0 };
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        maxResults: String(THREAD_LIST_PAGE_SIZE),
        q: `before:${beforeSeconds}`,
      });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await gmailFetch(accountId, `/users/me/threads?${params}`);
      if (!res.ok) {
        throw new GmailSyncError(`Gmail thread list failed (${res.status}).`);
      }
      const data = (await res.json()) as ThreadListResponse;
      const pageIds = (data.threads ?? []).map((t) => t.id);
      // Skip already-local threads (boundary overlap / prior partial
      // window) without spending the cap or a thread fetch on them.
      const existing = new Set(
        (
          await prisma.emailThread.findMany({
            where: { accountId, externalId: { in: pageIds } },
            select: { externalId: true },
          })
        ).map((t) => t.externalId)
      );
      for (const id of pageIds) {
        if (existing.has(id)) continue;
        if (threadsSynced >= cap) {
          assertNotAllFailed(passCtx);
          return await finishBackfill(account, threadsSynced, before);
        }
        // A poisoned thread is skipped (and logged), not fatal: it
        // isn't local, so the next window re-lists and retries it.
        if (await syncOneThread(accountId, id, labelMap, passCtx)) {
          threadsSynced++;
        }
      }
      pageToken = data.nextPageToken;
    } while (pageToken && threadsSynced < cap);

    assertNotAllFailed(passCtx);
    return await finishBackfill(account, threadsSynced, before);
  } catch (err) {
    if (err instanceof GmailAuthError) {
      // Never relabel a deliberately disconnected mailbox (a
      // disconnect can land mid-pass).
      await prisma.emailAccount.updateMany({
        where: { id: accountId, syncStatus: { not: "disconnected" } },
        data: { syncStatus: "error", syncError: err.message },
      });
      return {
        accountId,
        emailAddress: account.emailAddress,
        ok: false,
        threadsSynced: 0,
        before,
        error: err.message,
      };
    }
    const message =
      err instanceof Error && err.message ? err.message : "Backfill failed.";
    await prisma.emailAccount.updateMany({
      where: { id: accountId },
      data: { syncError: `Last backfill failed: ${message}` },
    });
    throw err;
  }
}

async function finishBackfill(
  account: { id: string; emailAddress: string },
  threadsSynced: number,
  before: Date
): Promise<BackfillResult> {
  const threadsIndexed = await prisma.emailThread.count({
    where: { accountId: account.id },
  });
  await prisma.emailAccount.updateMany({
    where: { id: account.id },
    data: { threadsIndexed },
  });
  return {
    accountId: account.id,
    emailAddress: account.emailAddress,
    ok: true,
    threadsSynced,
    before,
  };
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

/** Below this many failures a pass that imported nothing is treated
 *  as "a poisoned thread", above it as "something systemic is wrong"
 *  (see `assertNotAllFailed`). */
const ALL_FAILED_ABORT_MIN = 3;

/** Guard against skip-and-advance hiding a systemic failure: when
 *  EVERY attempted thread in a pass threw (and there were several),
 *  the cause is almost certainly not the data — abort so the cursor
 *  stays put and the next run retries. One or two failures with no
 *  success is still treated as isolated poison (a single-thread
 *  incremental pass whose only thread is poisoned must not wedge). */
function assertNotAllFailed(ctx: ThreadPassContext): void {
  if (ctx.failed.length >= ALL_FAILED_ABORT_MIN && ctx.ok === 0) {
    throw new GmailSyncError(
      `All ${ctx.failed.length} thread imports failed; aborting without advancing the sync cursor.`
    );
  }
}

/** Does the local copy of `gthread` (a `format=minimal` response)
 *  already match Gmail: same non-draft message count, same last
 *  message time, same read/star/archive flags? */
async function isThreadUnchanged(
  accountId: string,
  gthread: GmailThread
): Promise<boolean> {
  const messages = (gthread.messages ?? []).filter(
    (m) => !(m.labelIds ?? []).includes("DRAFT")
  );
  if (messages.length === 0) return false;
  const local = await prisma.emailThread.findUnique({
    where: { accountId_externalId: { accountId, externalId: gthread.id } },
    select: {
      messageCount: true,
      lastMessageAt: true,
      isRead: true,
      isStarred: true,
      isArchived: true,
    },
  });
  if (!local) return false;
  const lastMs = Math.max(...messages.map((m) => Number(m.internalDate ?? 0)));
  // Mirror upsertThread's junk handling so a junk-forced-read local
  // copy doesn't re-fetch on every catch-up pass.
  const isJunk = (m: GmailMessage): boolean =>
    (m.labelIds ?? []).some((l) => l === "SPAM" || l === "TRASH");
  const flags = messages.every(isJunk)
    ? { ...threadFlags(messages), isRead: true, isArchived: true }
    : threadFlags(messages.filter((m) => !isJunk(m)));
  return (
    local.messageCount === messages.length &&
    local.lastMessageAt.getTime() === lastMs &&
    local.isRead === flags.isRead &&
    local.isStarred === flags.isStarred &&
    local.isArchived === flags.isArchived
  );
}

/** Fetch one thread `format=full` and upsert it. Returns false when
 *  the thread 404s (deleted upstream) — the LOCAL copy is kept:
 *  filed email is part of the firm's matter record, not a mirror of
 *  the provider's retention choices — or when it was skipped (draft-
 *  only, a frontier-skipped unknown thread, an already-current
 *  catch-up thread, or a failed import).
 *
 *  Failure isolation: a DETERMINISTIC throw while PARSING/PERSISTING
 *  one thread (data the database rejects, a malformed payload) must
 *  not wedge the mailbox — the pass would abort before the history
 *  cursor advances and replay the same poisoned thread forever. Such
 *  threads are logged (account + thread id only, never content),
 *  recorded on `ctx.failed`, and skipped. Everything else aborts the
 *  pass so the cursor does NOT advance and the next run retries:
 *  auth errors, transport / status failures (`GmailSyncError`,
 *  thrown outside the try), and TRANSIENT database errors
 *  (`isTransientInfraError` — connection reset, pool timeout,
 *  deadlock). Skipping those would advance the cursor past mail that
 *  was never stored and is never re-fetched. */
async function syncOneThread(
  accountId: string,
  externalThreadId: string,
  labelMap: Map<string, string>,
  ctx: ThreadPassContext
): Promise<boolean> {
  const threadPath = `/users/me/threads/${encodeURIComponent(externalThreadId)}`;
  if (ctx.skipUnchanged) {
    const minimal = await gmailFetch(accountId, `${threadPath}?format=minimal`);
    if (minimal.status === 404) return false;
    if (!minimal.ok) {
      throw new GmailSyncError(`Gmail thread fetch failed (${minimal.status}).`);
    }
    let unchanged = false;
    try {
      unchanged = await isThreadUnchanged(
        accountId,
        (await minimal.json()) as GmailThread
      );
    } catch {
      // Cheap check only — any problem falls through to the full path,
      // which has the real error handling.
    }
    if (unchanged) {
      ctx.ok++;
      return false;
    }
  }
  const res = await gmailFetch(accountId, `${threadPath}?format=full`);
  if (res.status === 404) return false;
  if (!res.ok) {
    throw new GmailSyncError(`Gmail thread fetch failed (${res.status}).`);
  }
  try {
    const gthread = (await res.json()) as GmailThread;
    const written = await upsertThread(accountId, gthread, labelMap, {
      skipUnknownBefore: ctx.skipUnknownBefore,
    });
    ctx.ok++;
    return written;
  } catch (err) {
    if (err instanceof GmailAuthError || isTransientInfraError(err)) throw err;
    ctx.failed.push(externalThreadId);
    console.error(
      `[gmail-sync] thread import failed (account ${accountId}, thread ${externalThreadId}): ${
        err instanceof Error ? err.name : "unknown error"
      }`
    );
    return false;
  }
}

/** Persist one full Gmail thread. Exported for tests. Returns true
 *  when the thread was written, false when skipped.
 *
 *  - DRAFT-labelled messages are never stored (each draft save mints
 *    a new immutable message id, so they'd pile up as phantom
 *    unsent "messages", and could surface privileged text that was
 *    never sent). Any local copy of a message that now carries
 *    DRAFT is removed. A thread with nothing but drafts is skipped.
 *  - Every string from Google passes `stripNul` — Postgres text
 *    rejects U+0000.
 *  - `skipUnknownBefore`: skip a thread we have NO local copy of
 *    whose last message predates this instant (incremental sync's
 *    guard against dragging the backfill anchor backwards). */
export async function upsertThread(
  accountId: string,
  gthread: GmailThread,
  labelMap: Map<string, string>,
  opts?: { skipUnknownBefore?: Date | null }
): Promise<boolean> {
  const isDraft = (m: GmailMessage): boolean =>
    (m.labelIds ?? []).includes("DRAFT");
  const allMessages = gthread.messages ?? [];
  const draftIds = allMessages.filter(isDraft).map((m) => m.id);
  if (draftIds.length > 0) {
    await prisma.emailMessage.deleteMany({
      where: {
        externalId: { in: draftIds },
        thread: { accountId, externalId: gthread.id },
      },
    });
  }
  const messages: GmailMessage[] = allMessages
    .filter((m) => !isDraft(m))
    .sort((a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0));
  if (messages.length === 0) return false;
  const first = messages[0];
  const last = messages[messages.length - 1];

  // SPAM / TRASH: see the module docstring. A junk-only thread with no
  // local copy is not imported at all; a local one is kept but forced
  // read + archived below. Junk messages never drive the unread flag.
  const isJunk = (m: GmailMessage): boolean =>
    (m.labelIds ?? []).some((l) => l === "SPAM" || l === "TRASH");
  const junkOnly = messages.every(isJunk);
  if (junkOnly) {
    const known = await prisma.emailThread.findUnique({
      where: { accountId_externalId: { accountId, externalId: gthread.id } },
      select: { id: true },
    });
    if (!known) return false;
  }

  const subject =
    stripNul(decodeMimeWords(headerValue(first.payload, "Subject") ?? "")).trim() ||
    "(no subject)";
  const snippet = last.snippet
    ? stripNul(decodeHtmlEntities(last.snippet))
    : null;
  const lastMessageAt = new Date(Number(last.internalDate ?? Date.now()));

  if (opts?.skipUnknownBefore && lastMessageAt < opts.skipUnknownBefore) {
    const known = await prisma.emailThread.findUnique({
      where: { accountId_externalId: { accountId, externalId: gthread.id } },
      select: { id: true },
    });
    if (!known) return false;
  }

  const flags = junkOnly
    ? { ...threadFlags(messages), isRead: true, isArchived: true }
    : threadFlags(messages.filter((m) => !isJunk(m)));
  const parsed = messages.map(parseGmailMessage);
  const hasAttachments = parsed.some((p) => p.attachments.length > 0);

  // Provider-owned thread columns only — matterId / leadId / followUpAt /
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
      if (name) desired.add(stripNul(gmailLabelSlug(name)));
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

  // One lookup for the whole thread instead of a findUnique per
  // message (the pool is a single connection).
  const existingByExternalId = new Map(
    (
      await prisma.emailMessage.findMany({
        where: {
          threadId: thread.id,
          externalId: { in: parsed.map((p) => p.externalId) },
        },
        select: { id: true, externalId: true },
      })
    ).map((row) => [row.externalId, row.id] as const)
  );

  for (const p of parsed) {
    // SANITIZE AT WRITE TIME — the only path into EmailMessage.body.
    const body = stripNul(sanitizeEmailHtml(p.bodyHtmlRaw));
    const providerMessageFields = {
      fromName: stripNul(p.from.name || p.from.email),
      fromEmail: stripNul(p.from.email),
      toRecipients: stripNul(JSON.stringify(p.to)),
      ccRecipients:
        p.cc.length > 0 ? stripNul(JSON.stringify(p.cc)) : null,
      body,
      sentAt: p.sentAt,
    };
    // Provider fields refresh; isPrivileged (app-owned) and the
    // attachment rows (a later download writes a real fileUrl we
    // must not clobber — Gmail attachments are immutable anyway)
    // are left alone.
    const refresh = (id: string) =>
      prisma.emailMessage.update({
        where: { id },
        data: providerMessageFields,
      });
    const existingId = existingByExternalId.get(p.externalId);
    if (existingId) {
      await refresh(existingId);
      continue;
    }
    try {
      await prisma.emailMessage.create({
        data: {
          threadId: thread.id,
          externalId: p.externalId,
          ...providerMessageFields,
          attachments: {
            create: p.attachments.map((a) => ({
              filename: stripNul(a.filename),
              contentType: stripNulOrNull(a.mimeType),
              fileSize: a.size,
              // Gmail attachment id parked in fileUrl under a
              // recognizable scheme until the on-demand bytes fetch
              // ships; a real storage URL replaces it post-download.
              fileUrl: a.attachmentId ? `gmail:${a.attachmentId}` : null,
            })),
          },
        },
      });
    } catch (err) {
      // A concurrent pass (backfill, or a stolen stale claim) created
      // this message between our lookup and insert: the nested create
      // rolled back whole, so converge on the winner's row.
      if ((err as { code?: string } | null)?.code !== "P2002") throw err;
      const winner = await prisma.emailMessage.findUnique({
        where: {
          threadId_externalId: {
            threadId: thread.id,
            externalId: p.externalId,
          },
        },
        select: { id: true },
      });
      if (!winner) throw err;
      await refresh(winner.id);
    }
  }
  return true;
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
        transient: true,
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
    where: { userId, user: { isActive: true }, refreshToken: { not: null } },
    select: CONNECTED_ACCOUNT_SELECT,
    orderBy: { createdAt: "asc" },
  });
  return syncAccounts(accounts);
}

/** Sync every connected account of every user — the headless cron
 *  path. No session involved; each account syncs for its own user. */
export async function syncAllEmailAccounts(): Promise<AccountSyncResult[]> {
  const accounts = await prisma.emailAccount.findMany({
    // Deactivated members' mailboxes are NOT synced — deactivation
    // is the admin lever (see actions/email-accounts.ts).
    where: { user: { isActive: true }, refreshToken: { not: null } },
    select: CONNECTED_ACCOUNT_SELECT,
    // Least-recently-synced first (never-synced first): when the sweep
    // is cut off by the function ceiling, the accounts that were
    // reached last time go last this time, so one heavy mailbox can't
    // starve the others every tick.
    orderBy: [{ lastSyncAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
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
