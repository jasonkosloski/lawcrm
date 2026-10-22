/**
 * Email sync sweep — SYSTEM endpoint (headless cron path).
 *
 * Same sanctioned API-route exception + auth idiom as
 * /api/notification-sweep: a platform scheduler GETs this with
 * `Authorization: Bearer <CRON_SECRET>`; requests without the exact
 * bearer are rejected 401, and an unset CRON_SECRET rejects
 * everything (fail closed).
 *
 * Syncs EVERY connected email account across all users — no session
 * involved; each account syncs into its own user's mailbox. Per-
 * account failures are isolated inside `syncAllEmailAccounts` (one
 * revoked mailbox never blocks the firm).
 *
 * The Google Calendar pull piggybacks the same sweep for calendar-
 * scoped accounts (`pullCalendarForAllAccounts` — per-account
 * isolation inside, plus a catch here so even a wholesale calendar
 * failure never blocks the mail sweep).
 *
 * Status: 200 only when nothing failed. A throwing mailbox/calendar
 * pass or a wholesale calendar failure still finishes the sweep but
 * answers 500 with the full summary, so Vercel shows the cron run as
 * failed instead of a silent green. Reconnect-required and other
 * deliberate skips are not failures (the user has to act there).
 */

import { isAuthorizedCron } from "@/lib/cron-auth";
import { syncAllEmailAccounts } from "@/lib/google/gmail-sync";
import {
  pullCalendarForAllAccounts,
  type CalendarPullResult,
} from "@/lib/google/google-calendar-sync";

/** The sweep walks every mailbox + calendar sequentially; give it
 *  the Fluid-compute ceiling instead of the default so a first full
 *  sync isn't cut off mid-account (and then overlapped by the next
 *  every-5-minutes invocation). */
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCron(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await syncAllEmailAccounts();

    let calendar: CalendarPullResult[] = [];
    let calendarCrashed = false;
    try {
      calendar = await pullCalendarForAllAccounts();
    } catch (err) {
      calendarCrashed = true;
      console.error("[email-sync] calendar pull failed", err);
    }

    const transientFailures =
      results.filter((r) => r.transient).length + calendar.filter((c) => c.transient).length;
    const ok = transientFailures === 0 && !calendarCrashed;
    if (!ok) {
      console.error("[email-sync] sweep finished with failures", {
        transientFailures,
        calendarCrashed,
      });
    }

    return Response.json(
      {
        ok,
        transientFailures,
        calendarCrashed,
        accounts: results.length,
        // "skipped" passes (another sync held the account, reconnect
        // required, deactivated owner) did not sync anything.
        synced: results.filter((r) => r.ok && r.mode !== "skipped").length,
        // Poisoned threads skipped this sweep (ids are in the error log
        // and each account's syncError note).
        failedThreads: results.reduce((n, r) => n + (r.failedThreads ?? 0), 0),
        // Account ids only — no email addresses in cron logs.
        results: results.map(({ accountId, ok, mode, threadsSynced, failedThreads, error }) => ({
          accountId,
          ok,
          mode,
          threadsSynced,
          ...(failedThreads ? { failedThreads } : {}),
          ...(error ? { error } : {}),
        })),
        calendar: calendar.map(
          ({ accountId, ok, mode, imported, updated, deletedEvents, unlinked, error }) => ({
            accountId,
            ok,
            mode,
            imported,
            updated,
            deletedEvents,
            unlinked,
            ...(error ? { error } : {}),
          }),
        ),
      },
      { status: ok ? 200 : 500 },
    );
  } catch (err) {
    console.error("[email-sync] sweep failed", err);
    return Response.json({ ok: false, error: "Sync failed" }, { status: 500 });
  }
}
