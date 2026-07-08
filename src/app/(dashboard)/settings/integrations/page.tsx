/**
 * /settings/integrations — per-user third-party connections.
 *
 * Live today: Gmail (per-user OAuth). Everything else renders as an
 * "upcoming" list until its feature phase lands.
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
import { formatDate } from "@/lib/format-date";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { GmailIntegrationCard } from "@/components/settings/gmail-integration-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const UPCOMING_INTEGRATIONS = [
  "Google Calendar (per-user OAuth for event sync)",
  "Westlaw / research tools",
  "E-signature (DocuSign or similar)",
  "IOLTA trust account bank feed",
  "PACER / court filing integrations",
];

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
      _count: { select: { threads: true } },
    },
  });

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-base font-semibold text-ink">Integrations</h1>
        <p className="text-xs text-ink-3 mt-1">
          Third-party services connected to your account. Mailbox
          connections are personal — each team member connects their own.
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
          lastSyncLabel: a.lastSyncAt
            ? formatDate(a.lastSyncAt, "datetime_medium", tz)
            : null,
          threadCount: a._count.threads,
          syncError: a.syncError,
        }))}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Coming later</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5">
            {UPCOMING_INTEGRATIONS.map((item) => (
              <li key={item} className="text-xs text-ink-3">
                {item}
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-4 mt-3">
            Each integration lights up as its underlying feature phase
            lands (Calendar, Billing, etc.).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
