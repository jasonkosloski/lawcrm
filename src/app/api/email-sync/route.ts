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
 * revoked mailbox never blocks the firm), so this handler only
 * 500s on infrastructure-level failures.
 *
 * The Google Calendar pull piggybacks the same sweep for calendar-
 * scoped accounts (`pullCalendarForAllAccounts` — per-account
 * isolation inside, plus a catch here so even a wholesale calendar
 * failure never blocks the mail sweep or fails the request).
 */

import { syncAllEmailAccounts } from "@/lib/google/gmail-sync";
import {
  pullCalendarForAllAccounts,
  type CalendarPullResult,
} from "@/lib/google/google-calendar-sync";

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await syncAllEmailAccounts();

    let calendar: CalendarPullResult[] = [];
    try {
      calendar = await pullCalendarForAllAccounts();
    } catch (err) {
      console.error("[email-sync] calendar pull failed", err);
    }

    return Response.json({
      ok: true,
      accounts: results.length,
      synced: results.filter((r) => r.ok).length,
      // Account ids only — no email addresses in cron logs.
      results: results.map(({ accountId, ok, mode, threadsSynced, error }) => ({
        accountId,
        ok,
        mode,
        threadsSynced,
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
        })
      ),
    });
  } catch (err) {
    console.error("[email-sync] sweep failed", err);
    return Response.json({ ok: false, error: "Sync failed" }, { status: 500 });
  }
}
