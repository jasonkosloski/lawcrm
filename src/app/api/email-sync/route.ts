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
 */

import { syncAllEmailAccounts } from "@/lib/google/gmail-sync";

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await syncAllEmailAccounts();
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
    });
  } catch (err) {
    console.error("[email-sync] sweep failed", err);
    return Response.json({ ok: false, error: "Sync failed" }, { status: 500 });
  }
}
