/**
 * Google Calendar PUSH hooks — CRM event mutations flow out to the
 * creator's Google calendar. The other direction (Google → CRM) is
 * the pull engine (google-calendar-sync.ts); the shared resource
 * mapping + echo marker live in calendar-shared.ts.
 *
 * ## Push policy (v1)
 *
 *  - **Creator-only.** An event is pushed to its CREATOR's Google
 *    calendar, nobody else's. Attendee fan-out (a copy on every
 *    firm attendee's calendar) is a documented follow-up — the
 *    CalendarEventSync mapping is already per-(event, account) so
 *    the schema is ready.
 *  - **One calendar per creator.** A creator with several connected
 *    Google accounts gets the copy on the OLDEST connected account
 *    that has the calendar scope + a live refresh token. Rationale:
 *    duplicate copies of the same event across a user's own
 *    calendars are noise, not redundancy — most calendar apps
 *    overlay all connected accounts, so the user would see the
 *    event N times. Oldest-connected is deterministic and matches
 *    "the account they set up first is their main one." Exception:
 *    if a mapping row already exists on one of the creator's
 *    accounts (the pull engine created it, or the account order
 *    changed), that account wins — we PATCH the existing copy
 *    instead of minting a duplicate elsewhere.
 *  - **No attendees, ever.** eventToGoogleResource never emits
 *    them — see calendar-shared.ts for why (Google auto-emails
 *    invites on the owner's behalf).
 *  - **Insert vs patch by mapping.** No CalendarEventSync row for
 *    the chosen account → POST (insert) and record the mapping.
 *    Row exists → PATCH events/{googleEventId}. This is also how a
 *    Google-BORN event edited in the CRM flows back: the pull
 *    engine created the mapping on import, so the edit PATCHes the
 *    original Google copy — and since the patch body carries the
 *    LAWCRM_MARKER_KEY extended property, the Google copy becomes
 *    marker-tagged ("ours") from that point on. Intended: once the
 *    CRM has edited an event, the CRM is a system of record for it.
 *  - **PATCH 404/410 = deleted at Google.** We do NOT re-insert:
 *    the pull engine owns deleted-at-Google semantics (it will
 *    drop the CRM row / mapping on its next run), and resurrecting
 *    a copy the user just deleted at Google would fight it. Warn
 *    and leave the mapping for the pull engine to reconcile.
 *
 * ## Failure contract (mirrors gmail-writeback.ts)
 *
 * Both exports NEVER reject — the local CRM mutation always wins:
 *  - no creator / creator has no scoped+tokened Google account →
 *    silent skip (token-less accounts are skipped WITHOUT touching
 *    gmailFetch, which would flip a deliberately-disconnected
 *    account into the reconnect-required error state);
 *  - GmailAuthError (grant revoked) → recorded on the account
 *    (syncStatus "error" + syncError), same reconnect signal the
 *    sync engines raise;
 *  - anything transient (network, 5xx, rate limit) → console.warn
 *    and move on; Google lags until the next successful push/pull.
 *
 * ## Echo safety
 *
 * Push never fires from the pull path (the pull engine writes
 * prisma directly, never through the server actions that hook
 * push), and the pull engine recognizes pushed copies by mapping
 * row + the marker and applies last-write-wins — so push → pull →
 * push cannot cycle.
 */

import { prisma } from "@/lib/prisma";
import { GmailAuthError, gmailFetch } from "@/lib/google/gmail-client";
import {
  CALENDAR_API_BASE,
  eventToGoogleResource,
  hasCalendarScope,
} from "@/lib/google/calendar-shared";

/** Non-2xx from the Calendar API (auth failures are the client
 *  layer's GmailAuthError instead). Transient by assumption. */
export class CalendarPushError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarPushError";
  }
}

function eventUrl(googleCalendarId: string, googleEventId: string): string {
  return `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(
    googleCalendarId
  )}/events/${encodeURIComponent(googleEventId)}`;
}

function insertUrl(googleCalendarId: string): string {
  return `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(
    googleCalendarId
  )}/events`;
}

/** Record the reconnect-required signal on an account — same shape
 *  the sync engines + gmail-writeback persist. Belt + braces:
 *  gmail-client usually already flipped the account. */
async function markAuthError(err: GmailAuthError): Promise<void> {
  await prisma.emailAccount
    .updateMany({
      where: { id: err.accountId },
      data: { syncStatus: "error", syncError: err.message },
    })
    .catch((persistErr) => {
      console.warn(
        "[gcal-push] failed to record auth error",
        persistErr
      );
    });
}

/**
 * Push a CRM event to its creator's Google calendar. NEVER rejects
 * (safe to `await` inline after the local commit — see the module
 * docstring for the full contract). Insert when no mapping row
 * exists for the chosen account, PATCH otherwise; the
 * CalendarEventSync row is upserted with Google's event id +
 * `updated` stamp so the pull engine's last-write-wins has a fresh
 * anchor.
 */
export async function pushEventToGoogle(eventId: string): Promise<void> {
  try {
    const event = await prisma.calendarEvent.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        title: true,
        description: true,
        location: true,
        startTime: true,
        endTime: true,
        isAllDay: true,
        zoomUrl: true,
        createdById: true,
      },
    });
    // Deleted mid-flight, or a legacy creator-less row — no
    // calendar to push to.
    if (!event?.createdById) return;

    // The creator's usable Google connections: live refresh token
    // (token-less = deliberately disconnected; skip WITHOUT going
    // through gmailFetch) + the calendar scope actually granted.
    // Oldest-connected first — see the module docstring for why
    // exactly one account receives the copy.
    const accounts = await prisma.emailAccount.findMany({
      where: { userId: event.createdById, refreshToken: { not: null } },
      orderBy: { createdAt: "asc" },
      select: { id: true, grantedScopes: true },
    });
    const scoped = accounts.filter((a) => hasCalendarScope(a.grantedScopes));
    if (scoped.length === 0) return;

    // Prefer an account that ALREADY holds this event's mapping
    // (pull-imported events, or a since-added older account) —
    // patching the existing copy beats minting a duplicate.
    const mappings = await prisma.calendarEventSync.findMany({
      where: { eventId, accountId: { in: scoped.map((a) => a.id) } },
      select: {
        accountId: true,
        googleEventId: true,
        googleCalendarId: true,
      },
    });
    const mappingByAccount = new Map(mappings.map((m) => [m.accountId, m]));
    const target =
      scoped.find((a) => mappingByAccount.has(a.id)) ?? scoped[0];
    const mapping = mappingByAccount.get(target.id);

    const resource = eventToGoogleResource(event);
    const init = {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(resource),
    };

    let res: Response;
    if (mapping) {
      res = await gmailFetch(
        target.id,
        eventUrl(mapping.googleCalendarId, mapping.googleEventId),
        { ...init, method: "PATCH" }
      );
      if (res.status === 404 || res.status === 410) {
        // Copy deleted at Google. Deliberately NOT re-inserted —
        // the pull engine owns deleted-at-Google reconciliation
        // and re-creating here would resurrect an event the user
        // just removed there.
        console.warn(
          `[gcal-push] Google copy of event ${eventId} is gone (${res.status}); leaving for the pull engine to reconcile.`
        );
        return;
      }
    } else {
      res = await gmailFetch(target.id, insertUrl("primary"), {
        ...init,
        method: "POST",
      });
    }
    if (!res.ok) {
      throw new CalendarPushError(
        `Calendar ${mapping ? "patch" : "insert"} failed (${res.status}).`
      );
    }

    const g = (await res.json()) as { id?: string; updated?: string };
    if (!g.id) {
      throw new CalendarPushError("Calendar response carried no event id.");
    }
    // Google's `updated` stamp anchors last-write-wins on the pull
    // side. Always present in practice; fall back to "now" (≈ the
    // write we just made) rather than null so LWW never regresses
    // to "unknown".
    const updatedRaw = g.updated ? new Date(g.updated) : null;
    const googleUpdatedAt =
      updatedRaw && !Number.isNaN(updatedRaw.getTime())
        ? updatedRaw
        : new Date();

    await prisma.calendarEventSync.upsert({
      where: { eventId_accountId: { eventId, accountId: target.id } },
      update: {
        googleEventId: g.id,
        googleUpdatedAt,
        lastSyncedAt: new Date(),
      },
      create: {
        eventId,
        accountId: target.id,
        googleEventId: g.id,
        googleCalendarId: mapping?.googleCalendarId ?? "primary",
        googleUpdatedAt,
      },
    });
  } catch (err) {
    if (err instanceof GmailAuthError) {
      await markAuthError(err);
      return;
    }
    // Transient (network / 5xx / rate limit / DB hiccup) — the
    // local event is committed and is the user's intent; Google
    // converges on the next push or pull.
    console.warn("[gcal-push] event push failed", err);
  }
}

/**
 * Delete every Google copy of a CRM event — one DELETE per
 * CalendarEventSync row (pull-created mappings included), then the
 * mapping rows themselves. NEVER rejects, and per-account failures
 * don't stop the other accounts' deletes.
 *
 * MUST run BEFORE the CRM row deletion: the mapping rows cascade
 * away with the event, so this is the last moment they're
 * readable.
 *
 * Honesty about the failure mode: a transient Google failure (or a
 * token-less / unscoped account we skip) leaves that Google copy
 * ORPHANED — the CRM delete proceeds regardless (local mutation
 * wins) and the mapping is removed, so nothing will retry. The
 * user removes the stray copy at Google manually. Accepted for v1;
 * a retry queue is the follow-up if it bites in practice.
 */
export async function deleteEventFromGoogle(eventId: string): Promise<void> {
  try {
    const mappings = await prisma.calendarEventSync.findMany({
      where: { eventId },
      select: {
        accountId: true,
        googleEventId: true,
        googleCalendarId: true,
        account: { select: { refreshToken: true, grantedScopes: true } },
      },
    });

    for (const m of mappings) {
      try {
        // Token-less = disconnected; unscoped = reconnected without
        // the calendar grant (the DELETE would 403). Skip silently
        // either way — see the orphaned-copy note above.
        if (
          !m.account.refreshToken ||
          !hasCalendarScope(m.account.grantedScopes)
        ) {
          continue;
        }
        const res = await gmailFetch(
          m.accountId,
          eventUrl(m.googleCalendarId, m.googleEventId),
          { method: "DELETE" }
        );
        // 404/410 = already gone at Google. That's the outcome we
        // wanted; tolerate.
        if (!res.ok && res.status !== 404 && res.status !== 410) {
          throw new CalendarPushError(
            `Calendar delete failed (${res.status}).`
          );
        }
      } catch (err) {
        if (err instanceof GmailAuthError) {
          await markAuthError(err);
          continue;
        }
        console.warn(
          `[gcal-push] Google delete failed for event ${eventId} on account ${m.accountId}; the Google copy is orphaned until removed manually.`,
          err
        );
      }
    }

    // Remove the mappings we just serviced. Belt + braces — the
    // caller's CRM delete cascades them anyway — but it keeps this
    // function correct standalone (e.g. a future "disconnect
    // calendar sync" action).
    await prisma.calendarEventSync.deleteMany({ where: { eventId } });
  } catch (err) {
    console.warn("[gcal-push] event delete sweep failed", err);
  }
}
