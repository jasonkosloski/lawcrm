/**
 * Google Calendar PULL engine — Google → CRM. The push direction
 * (CRM → Google) lives in google-calendar-push.ts; the shared
 * contract (API base, scope, echo marker, field mapping) is
 * calendar-shared.ts and is the ONLY coupling between the two.
 *
 * Entry points:
 *   - `pullCalendarForAccount(accountId)` — one Google connection's
 *     "primary" calendar. Skips cleanly (no error, no Google
 *     traffic) when the account lacks the calendar scope.
 *   - `pullCalendarForUserAccounts(userId)` / `pullCalendarForAllAccounts()`
 *     — multi-account wrappers with per-account failure isolation,
 *     mirroring gmail-sync's. They piggyback the existing email-sync
 *     triggers (the "Sync now" action + the /api/email-sync cron),
 *     so calendar pull needs no trigger surface of its own.
 *
 * Sync strategy
 * -------------
 * Incremental: events.list on `primary` with the stored
 * `EmailAccount.calendarSyncToken`. A 410 GONE means the token
 * expired at Google → transparent full re-pull. Full: a bounded
 * window (`timeMin` = now − PULL_WINDOW_PAST_DAYS, `timeMax` =
 * now + PULL_WINDOW_FUTURE_DAYS) — a lawyer's operative calendar,
 * not their life archive. BOTH passes send `singleEvents=true` so
 * recurring series arrive as individual instances: the CRM has no
 * recurrence model, and per-instance rows are the honest mapping
 * (Google also requires the flag to be consistent across a
 * syncToken's lifetime). Each pass persists the response's
 * `nextSyncToken`. A full pull never sees old deletions
 * (`showDeleted` stays default-false) — cancellations reconcile via
 * the incremental stream, which always includes them.
 *
 * ECHO SAFETY — this module writes CalendarEvent rows via prisma
 * DIRECTLY, never through the calendar-events server actions. The
 * actions carry the push hooks (google-calendar-push), so routing a
 * pull through them would push Google's own change back at Google
 * in a loop. Pull writes are terminal by construction; the test
 * suite pins that this file never imports the push module or the
 * actions.
 *
 * Per-item rules
 * --------------
 * MAPPED events (a copy we know): an item whose `updated` is no
 * newer than the mapping's stored `googleUpdatedAt` is the ECHO of
 * our own push and is ignored (only bookkeeping moves) — comparing
 * against CalendarEvent.updatedAt instead would write Google's lossy
 * copy back after every push. A genuinely newer Google edit then
 * goes through last-write-wins on fields: its `updated` must be
 * strictly newer than the CRM row's `updatedAt` for the CRM row to
 * be overwritten (via googleEventToCrmFields, with the push-side
 * Zoom fold stripped).
 *
 * MARKED + UNMAPPED events (lawcrmIdOf set, no mapping on this
 * Google event): the marker is only honored for a CRM event this
 * account legitimately owns — it already has a mapping on THIS
 * account, or the account's user created it. A marker naming anyone
 * else's CRM event (ids are visible to every calendar viewer, and
 * anyone can write the property) is ignored and the item imports as
 * an ordinary personal event. A marker pointing at a CRM event that
 * no longer exists is skipped — the CRM deleted it and the push
 * engine owns propagating that; re-importing would resurrect
 * deleted firm events.
 *
 * UNMARKED events (Google-born): imported as a personal CRM event —
 * `createdById` = the connection owner, `visibility` "default",
 * `type` "meeting", no matter — plus the mapping row. v1 import
 * policy: every non-cancelled item in the window/stream is imported,
 * including tentative, declined, and free/transparent ones — the
 * CRM mirrors what sits on the user's calendar and lets them prune
 * there; a smarter skip heuristic can come later.
 *
 * CANCELLATION RULE (unlink-only): a cancelled item with a mapping
 * deletes ONLY the mapping (`CalendarEventSync` row); the CRM event
 * is NEVER deleted by a Google-side cancel. The schema has no
 * durable "Google-born" flag, and cancelled items carry only
 * id+status, so there is no reliable way to tell a personal import
 * from a CRM-born matterless "meeting" (a very common creation, with
 * the creator as sole attendee) — any shape-based delete rule can
 * hard-delete firm data (notes / time entries / tasks would lose
 * their link) with no audit trail. Worst case here: an imported
 * personal event that was deleted in Google lingers in the CRM until
 * someone removes it there. If product wants Google-born cleanup it
 * needs an origin flag on CalendarEvent (open item in
 * docs/FEATURES.md); `deletedEvents` stays in the result shape (always
 * 0) so the cron response is stable.
 *
 * Failure semantics per account (gmail-sync's discipline):
 *   - `GmailAuthError` (reconnect required) → account flipped to
 *     syncStatus "error" + syncError, result `{ok:false}` — STOP.
 *   - transient → `syncError` notes the failure under a
 *     calendar-specific prefix (so a later calendar success clears
 *     only its own note, never an email-sync failure's) and the
 *     error is RETHROWN; the multi-account wrappers catch it into a
 *     per-account result so one broken calendar never blocks the
 *     rest — nor, at the trigger layer, mail sync itself.
 */

import { prisma } from "@/lib/prisma";
import { GmailAuthError, gmailFetch } from "@/lib/google/gmail-client";
import { isTransientInfraError } from "@/lib/google/transient-error";
import {
  CALENDAR_API_BASE,
  googleEventToCrmFields,
  hasCalendarScope,
  lawcrmIdOf,
  stripZoomLine,
  type GoogleEventResource,
} from "@/lib/google/calendar-shared";

// ── Tuning constants ─────────────────────────────────────────────────────

/** Full-pull window: this far back from now (`timeMin`). */
export const PULL_WINDOW_PAST_DAYS = 30;
/** Full-pull window: this far ahead of now (`timeMax`). */
export const PULL_WINDOW_FUTURE_DAYS = 400;
/** events.list page size (Google max 2500; modest keeps payloads sane). */
const EVENTS_PAGE_SIZE = 250;
/** The calendar every account syncs in v1. */
const PRIMARY_CALENDAR_ID = "primary";
/** syncError prefix for transient calendar failures — success only
 *  clears notes carrying THIS prefix (the column is shared with
 *  email sync, whose notes we must not eat). */
export const CALENDAR_SYNC_ERROR_PREFIX = "Last calendar sync failed: ";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A pass where at least this many items failed and none succeeded is
 *  treated as systemic and aborted (see runPullPass). */
const ALL_FAILED_ABORT_MIN = 3;

/** Transient calendar-sync failure (bad response, unexpected
 *  shape). The account is NOT flipped to error — next attempt
 *  retries. Mirrors GmailSyncError. */
export class CalendarSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarSyncError";
  }
}

export type CalendarPullResult = {
  accountId: string;
  emailAddress: string;
  ok: boolean;
  /** "skipped" = no calendar scope, reconnect-required account, or
   *  a transient failure caught by a wrapper. */
  mode: "incremental" | "full" | "skipped";
  /** Google-born events created locally this pass. */
  imported: number;
  /** CRM events overwritten by a newer Google edit (LWW). */
  updated: number;
  /** Always 0 — a Google-side cancel never deletes a CRM event
   *  (kept so the cron response shape is stable). */
  deletedEvents: number;
  /** Mappings removed on a Google-side cancellation (the CRM event
   *  itself always survives). */
  unlinked: number;
  /** Items whose import threw and were skipped (poison-item
   *  isolation); surfaced on the account's syncError too. */
  failed?: number;
  error?: string;
};

type PullCounters = Required<
  Pick<
    CalendarPullResult,
    "imported" | "updated" | "deletedEvents" | "unlinked" | "failed"
  >
>;

type EventsListResponse = {
  items?: GoogleEventResource[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

type AccountForPull = {
  id: string;
  userId: string;
  emailAddress: string;
  calendarSyncToken: string | null;
};

// ── Single-account pull ──────────────────────────────────────────────────

export async function pullCalendarForAccount(
  accountId: string
): Promise<CalendarPullResult> {
  const account = await prisma.emailAccount.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      userId: true,
      emailAddress: true,
      grantedScopes: true,
      calendarSyncToken: true,
      user: { select: { isActive: true } },
    },
  });
  if (!account) {
    throw new CalendarSyncError("Email account not found.");
  }
  // Deactivated owner — no calendar traffic, state untouched.
  if (!account.user.isActive) {
    return emptyResult(account, "skipped", {
      ok: false,
      error: "Account owner is deactivated.",
    });
  }

  // Scope gate — pre-calendar connections skip cleanly with zero
  // Google traffic. The integrations card tells them to reconnect.
  if (!hasCalendarScope(account.grantedScopes)) {
    return emptyResult(account, "skipped", { ok: true });
  }

  let mode: "incremental" | "full" = account.calendarSyncToken
    ? "incremental"
    : "full";
  try {
    let outcome: PullOutcome | "sync-token-expired";
    if (account.calendarSyncToken) {
      outcome = await runPullPass(account, account.calendarSyncToken);
      if (outcome === "sync-token-expired") {
        // 410 GONE — token aged out at Google → full windowed re-pull.
        mode = "full";
        outcome = await runPullPass(account, null);
      }
    } else {
      outcome = await runPullPass(account, null);
    }
    if (outcome === "sync-token-expired") {
      // A windowed full pull carries no syncToken, so Google can't
      // 410 it — unreachable, but keep the type honest.
      throw new CalendarSyncError("Calendar full pull rejected unexpectedly.");
    }

    await prisma.emailAccount.update({
      where: { id: accountId },
      data: {
        calendarSyncToken: outcome.nextSyncToken ?? account.calendarSyncToken,
      },
    });
    if (outcome.counters.failed > 0) {
      // Skipped items stay visible — but never overwrite an email-
      // sync note in the shared column.
      await prisma.emailAccount.updateMany({
        where: {
          id: accountId,
          OR: [
            { syncError: null },
            { syncError: { startsWith: CALENDAR_SYNC_ERROR_PREFIX } },
          ],
        },
        data: {
          syncError: `${CALENDAR_SYNC_ERROR_PREFIX}${outcome.counters.failed} event(s) could not be imported and were skipped.`,
        },
      });
    } else {
      // Clear only OUR transient note; an email-sync failure note in
      // the shared column must survive a calendar success.
      await prisma.emailAccount.updateMany({
        where: {
          id: accountId,
          syncError: { startsWith: CALENDAR_SYNC_ERROR_PREFIX },
        },
        data: { syncError: null },
      });
    }

    return {
      accountId,
      emailAddress: account.emailAddress,
      ok: true,
      mode,
      ...outcome.counters,
    };
  } catch (err) {
    if (err instanceof GmailAuthError) {
      // Reconnect required — gmail-client usually already flipped
      // the account; make it unconditional and STOP.
      await prisma.emailAccount.updateMany({
        where: { id: accountId },
        data: { syncStatus: "error", syncError: err.message },
      });
      return emptyResult(account, mode, { ok: false, error: err.message });
    }
    // Transient — note it (calendar-prefixed), rethrow for wrappers.
    const message =
      err instanceof Error && err.message
        ? err.message
        : "Calendar sync failed.";
    await prisma.emailAccount.updateMany({
      where: { id: accountId },
      data: { syncError: `${CALENDAR_SYNC_ERROR_PREFIX}${message}` },
    });
    throw err;
  }
}

function emptyResult(
  account: { id: string; emailAddress: string },
  mode: CalendarPullResult["mode"],
  rest: { ok: boolean; error?: string }
): CalendarPullResult {
  return {
    accountId: account.id,
    emailAddress: account.emailAddress,
    mode,
    imported: 0,
    updated: 0,
    deletedEvents: 0,
    unlinked: 0,
    failed: 0,
    ...rest,
  };
}

// ── The list walk ────────────────────────────────────────────────────────

type PullOutcome = {
  nextSyncToken: string | null;
  counters: PullCounters;
};

/** One events.list pass to exhaustion — incremental when
 *  `syncToken` is given, windowed full otherwise. Returns
 *  "sync-token-expired" on 410 (incremental only). */
async function runPullPass(
  account: AccountForPull,
  syncToken: string | null
): Promise<PullOutcome | "sync-token-expired"> {
  const counters: PullCounters = {
    imported: 0,
    updated: 0,
    deletedEvents: 0,
    unlinked: 0,
    failed: 0,
  };
  let nextSyncToken: string | null = null;
  let pageToken: string | undefined;
  let okItems = 0;

  do {
    const params = new URLSearchParams({
      maxResults: String(EVENTS_PAGE_SIZE),
      // Recurring series arrive as individual instances — the CRM
      // has no recurrence model. Must stay consistent between the
      // token-minting full pull and every incremental after it.
      singleEvents: "true",
    });
    if (syncToken) {
      // With a syncToken Google forbids the window params (and
      // always includes deletions).
      params.set("syncToken", syncToken);
    } else {
      const now = Date.now();
      params.set(
        "timeMin",
        new Date(now - PULL_WINDOW_PAST_DAYS * DAY_MS).toISOString()
      );
      params.set(
        "timeMax",
        new Date(now + PULL_WINDOW_FUTURE_DAYS * DAY_MS).toISOString()
      );
    }
    if (pageToken) params.set("pageToken", pageToken);

    // gmailFetch passes absolute https:// URLs through — calendar
    // calls ride the same authenticated wrapper (token refresh,
    // 401 retry, GmailAuthError on revocation).
    const res = await gmailFetch(
      account.id,
      `${CALENDAR_API_BASE}/calendars/${PRIMARY_CALENDAR_ID}/events?${params}`
    );
    if (res.status === 410 && syncToken) return "sync-token-expired";
    if (!res.ok) {
      throw new CalendarSyncError(
        `Google Calendar events list failed (${res.status}).`
      );
    }
    const data = (await res.json()) as EventsListResponse;
    for (const item of data.items ?? []) {
      // One item the database rejects must not wedge the calendar:
      // the pass would abort before the sync token is saved and
      // replay the same item forever. Auth errors still stop the
      // account; anything else is logged (ids only) and counted.
      try {
        await applyGoogleEvent(account, item, counters);
        okItems++;
      } catch (err) {
        // Auth errors stop the account; TRANSIENT database errors
        // (connection reset, pool timeout, deadlock) abort the pass
        // too — skipping them would save the sync token past updates
        // and cancellations that were never applied and never come
        // back. Only deterministic data errors are skipped.
        if (err instanceof GmailAuthError || isTransientInfraError(err)) {
          throw err;
        }
        counters.failed++;
        console.error(
          `[gcal-sync] event import failed (account ${account.id}, event ${item.id ?? "?"}): ${
            err instanceof Error ? err.name : "unknown error"
          }`
        );
      }
    }
    if (data.nextSyncToken) nextSyncToken = data.nextSyncToken;
    pageToken = data.nextPageToken;
  } while (pageToken);

  // Several items, none applied: systemic, not poison — abort so the
  // sync token is not saved past them (a lone bad item still skips).
  if (counters.failed >= ALL_FAILED_ABORT_MIN && okItems === 0) {
    throw new CalendarSyncError(
      `All ${counters.failed} calendar items failed to import; sync token not advanced.`
    );
  }

  return { nextSyncToken, counters };
}

// ── Per-item application ─────────────────────────────────────────────────

async function applyGoogleEvent(
  account: AccountForPull,
  item: GoogleEventResource,
  counters: PullCounters
): Promise<void> {
  if (!item.id) return;

  if (item.status === "cancelled") {
    await applyCancellation(account, item.id, counters);
    return;
  }

  const fields = googleEventToCrmFields(item);
  if (!fields) return; // malformed (no usable times) — skip
  const googleUpdatedAt = parseGoogleUpdated(item.updated);

  const mapping = await prisma.calendarEventSync.findUnique({
    where: {
      accountId_googleEventId: {
        accountId: account.id,
        googleEventId: item.id,
      },
    },
    select: { id: true, eventId: true, googleUpdatedAt: true },
  });

  if (mapping) {
    // Known copy. ECHO CHECK FIRST: every push stores Google's own
    // `updated` stamp on the mapping, and the next incremental pull
    // returns that same write back. An item no newer than the
    // mapping's stamp is our own echo (or older) — applying it would
    // clobber the CRM row with Google's lossy copy (Zoom line
    // folded into the description, cleared fields restored). Only
    // a genuinely newer Google edit proceeds to last-write-wins
    // against the CRM row.
    const isEcho =
      mapping.googleUpdatedAt !== null &&
      googleUpdatedAt !== null &&
      googleUpdatedAt.getTime() <= mapping.googleUpdatedAt.getTime();
    if (!isEcho) {
      const written = await lwwUpdateEvent(
        mapping.eventId,
        fields,
        googleUpdatedAt
      );
      if (written) counters.updated++;
    }
    await prisma.calendarEventSync.update({
      where: { id: mapping.id },
      data: {
        googleUpdatedAt: isEcho
          ? mapping.googleUpdatedAt
          : (googleUpdatedAt ?? mapping.googleUpdatedAt),
        lastSyncedAt: new Date(),
      },
    });
    return;
  }

  const markedEventId = lawcrmIdOf(item);
  if (markedEventId) {
    // A copy carrying a CRM event id but with no mapping on this
    // Google event. The marker is just a string anyone can put on an
    // event in their own Google calendar, and CRM event ids are
    // visible to every calendar viewer — so it is only honored for
    // an event this account legitimately owns: the CRM event
    // already has a mapping on THIS account (mapping re-pointed
    // after a lost row / duplicate), or the account's user created
    // it. Anything else is treated as an ordinary Google-born event
    // (imported as a personal copy below) — it never adopts, edits,
    // or later deletes someone else's CRM event.
    const event = await prisma.calendarEvent.findUnique({
      where: { id: markedEventId },
      select: { id: true, createdById: true },
    });
    if (!event) return; // CRM deleted it — the push engine's problem
    const ownMapping = await prisma.calendarEventSync.findUnique({
      where: {
        eventId_accountId: { eventId: event.id, accountId: account.id },
      },
      select: { googleUpdatedAt: true },
    });
    if (ownMapping || event.createdById === account.userId) {
      await prisma.calendarEventSync.upsert({
        where: {
          eventId_accountId: { eventId: event.id, accountId: account.id },
        },
        create: {
          eventId: event.id,
          accountId: account.id,
          googleEventId: item.id,
          googleUpdatedAt,
        },
        update: {
          googleEventId: item.id,
          googleUpdatedAt,
          lastSyncedAt: new Date(),
        },
      });
      // Same echo guard as the mapped branch, against the stamp the
      // account's existing mapping held before this re-point.
      const isEcho =
        ownMapping?.googleUpdatedAt != null &&
        googleUpdatedAt !== null &&
        googleUpdatedAt.getTime() <= ownMapping.googleUpdatedAt.getTime();
      if (!isEcho) {
        const written = await lwwUpdateEvent(
          event.id,
          fields,
          googleUpdatedAt
        );
        if (written) counters.updated++;
      }
      return;
    }
    // fall through: foreign marker → personal import
  }

  // Unmarked + unmapped = Google-born → import as a personal event.
  // DIRECT prisma create (not createCalendarEvent) — see the echo-
  // safety note in the module docstring.
  await prisma.calendarEvent.create({
    data: {
      createdById: account.userId,
      visibility: "default",
      type: "meeting",
      matterId: null,
      title: fields.title,
      description: fields.description,
      location: fields.location,
      startTime: fields.startTime,
      endTime: fields.endTime,
      isAllDay: fields.isAllDay,
      googleSyncs: {
        create: {
          accountId: account.id,
          googleEventId: item.id,
          googleUpdatedAt,
        },
      },
    },
  });
  counters.imported++;
}

/** Overwrite the CRM row from Google ONLY when Google's `updated`
 *  is strictly newer than the CRM row's `updatedAt` (last-write-
 *  wins; a missing `updated` never wins). Direct prisma — never the
 *  calendar-events actions (push-echo safety). Returns whether a
 *  write happened. */
async function lwwUpdateEvent(
  eventId: string,
  fields: NonNullable<ReturnType<typeof googleEventToCrmFields>>,
  googleUpdatedAt: Date | null
): Promise<boolean> {
  if (!googleUpdatedAt) return false;
  const event = await prisma.calendarEvent.findUnique({
    where: { id: eventId },
    select: { updatedAt: true, zoomUrl: true },
  });
  if (!event || googleUpdatedAt.getTime() <= event.updatedAt.getTime()) {
    return false;
  }
  await prisma.calendarEvent.update({
    where: { id: eventId },
    data: {
      title: fields.title,
      // Undo the push-side "Zoom: <url>" fold so a genuine Google
      // edit doesn't write it into the CRM description (the next
      // push would stack another copy).
      description: stripZoomLine(fields.description, event.zoomUrl),
      location: fields.location,
      startTime: fields.startTime,
      endTime: fields.endTime,
      isAllDay: fields.isAllDay,
    },
  });
  return true;
}

/** The cancellation rule — see the module docstring: unlink only. */
async function applyCancellation(
  account: AccountForPull,
  googleEventId: string,
  counters: PullCounters
): Promise<void> {
  const mapping = await prisma.calendarEventSync.findUnique({
    where: {
      accountId_googleEventId: { accountId: account.id, googleEventId },
    },
    select: { id: true },
  });
  if (!mapping) return; // never imported (or already unlinked)

  // Unlink only — the CRM event survives (see the module docstring).
  await prisma.calendarEventSync.delete({ where: { id: mapping.id } });
  counters.unlinked++;
}

function parseGoogleUpdated(updated: string | undefined): Date | null {
  if (!updated) return null;
  const d = new Date(updated);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ── Multi-account wrappers ───────────────────────────────────────────────

type AccountRow = {
  id: string;
  emailAddress: string;
  syncStatus: string;
  syncError: string | null;
};

async function pullAccounts(
  accounts: AccountRow[]
): Promise<CalendarPullResult[]> {
  const results: CalendarPullResult[] = [];
  for (const account of accounts) {
    if (account.syncStatus === "error") {
      // Reconnect required — hitting Google again just fails.
      results.push(
        emptyResult(account, "skipped", {
          ok: false,
          error: account.syncError ?? "Reconnect required.",
        })
      );
      continue;
    }
    try {
      results.push(await pullCalendarForAccount(account.id));
    } catch (err) {
      // Transient — isolated so one broken calendar never blocks
      // the others (or, at the trigger layer, mail sync).
      results.push(
        emptyResult(account, "skipped", {
          ok: false,
          error:
            err instanceof Error && err.message
              ? err.message
              : "Calendar sync failed.",
        })
      );
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

/** Pull for every connected account of `userId` — rides the "Sync
 *  now" server action. Accounts without the calendar scope come
 *  back mode:"skipped" from `pullCalendarForAccount`. */
export async function pullCalendarForUserAccounts(
  userId: string
): Promise<CalendarPullResult[]> {
  const accounts = await prisma.emailAccount.findMany({
    where: { userId, user: { isActive: true }, refreshToken: { not: null } },
    select: CONNECTED_ACCOUNT_SELECT,
    orderBy: { createdAt: "asc" },
  });
  return pullAccounts(accounts);
}

/** Pull for every connected account of every user — rides the
 *  /api/email-sync cron sweep. */
export async function pullCalendarForAllAccounts(): Promise<
  CalendarPullResult[]
> {
  const accounts = await prisma.emailAccount.findMany({
    // Deactivated members' calendars are not pulled.
    where: { user: { isActive: true }, refreshToken: { not: null } },
    select: CONNECTED_ACCOUNT_SELECT,
    orderBy: { createdAt: "asc" },
  });
  return pullAccounts(accounts);
}
