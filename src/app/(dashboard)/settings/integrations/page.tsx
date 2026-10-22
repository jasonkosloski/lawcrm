/**
 * /settings/integrations — per-user third-party connections.
 *
 * Live today: Gmail (per-user OAuth). Unbuilt integrations are not
 * listed (they live on the roadmap, not in the UI).
 *
 * Auth: session only — NO permission key, deliberately. Connecting
 * YOUR OWN mailbox is identity-scoped, exactly like notification
 * prefs or saved searches (the documented no-permission-key
 * precedents): the page only ever shows/mutates the current user's
 * accounts, and a connection grants nothing firm-wide. The old
 * placeholder's firm.edit_info stand-in gate is gone on purpose —
 * a paralegal connecting their mailbox must not require firm-admin
 * powers.
 *
 * ?connected=1 / ?error=<code> arrive from the OAuth callback
 * redirect and render as one-shot banners inside the Gmail card.
 */

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { googleIntegrationConfigured } from "@/lib/google/oauth";
import { hasCalendarScope } from "@/lib/google/calendar-shared";
import { formatDate } from "@/lib/format-date";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { GmailIntegrationCard } from "@/components/settings/gmail-integration-card";

export default async function IntegrationsSettingsPage({
  searchParams,
}: {
  // Next.js 16: searchParams is a Promise that must be awaited.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const userId = await getCurrentUserId();
  const sp = await searchParams;
  const tz = await getCurrentUserTimeZone();

  const accounts = await prisma.emailAccount.findMany({
    where: { userId, provider: "gmail" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      emailAddress: true,
      syncStatus: true,
      lastSyncAt: true,
      syncError: true,
      grantedScopes: true,
      _count: { select: { threads: true } },
    },
  });

  // Oldest local thread per account — anchors the "Load older
  // emails" backfill button (each click walks one window below it).
  const oldestByAccount = new Map<string, Date>();
  if (accounts.length > 0) {
    const oldest = await prisma.emailThread.groupBy({
      by: ["accountId"],
      where: { accountId: { in: accounts.map((a) => a.id) } },
      _min: { lastMessageAt: true },
    });
    for (const o of oldest) {
      if (o._min.lastMessageAt) {
        oldestByAccount.set(o.accountId, o._min.lastMessageAt);
      }
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-base font-semibold text-ink">Integrations</h1>
        <p className="text-xs text-ink-3 mt-1">
          Third-party services connected to your account. Mailbox connections are personal — each
          team member connects their own.
        </p>
      </div>

      <GmailIntegrationCard
        configured={googleIntegrationConfigured()}
        justConnected={sp.connected === "1"}
        errorCode={typeof sp.error === "string" ? sp.error : null}
        accounts={accounts.map((a) => ({
          id: a.id,
          emailAddress: a.emailAddress,
          syncStatus: a.syncStatus,
          lastSyncLabel: a.lastSyncAt ? formatDate(a.lastSyncAt, "datetime_medium", tz) : null,
          threadCount: a._count.threads,
          syncError: a.syncError,
          oldestThreadLabel: oldestByAccount.has(a.id)
            ? formatDate(oldestByAccount.get(a.id)!, "medium", tz)
            : null,
          calendarSyncEnabled: hasCalendarScope(a.grantedScopes),
        }))}
      />
    </div>
  );
}
