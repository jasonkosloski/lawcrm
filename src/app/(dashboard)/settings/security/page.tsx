/**
 * /settings/security — the signed-in user's own account security.
 *
 * Identity-scoped like /settings/profile (no permission key): the
 * devices signed in to this account (live from Clerk, with per-device
 * revoke), plus this user's recent sign-in activity read from the
 * `auth` rows in ActivityLog (src/lib/auth-events.ts). Firm-wide
 * auth events live on /settings/activity under "Security".
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SessionList } from "@/components/settings/session-list";
import { EmptyState } from "@/components/shared/empty-state";
import { AUTH_EVENT_TITLES } from "@/lib/auth-events";
import { listActiveStaffSessions } from "@/lib/clerk-admin";
import { requireUser } from "@/lib/current-user";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { formatDate } from "@/lib/format-date";
import { prisma } from "@/lib/prisma";
import { getStaffAuth } from "@/lib/staff-auth";
import { cn } from "@/lib/utils";

const HISTORY_LIMIT = 15;

export default async function SecuritySettingsPage() {
  const userId = await requireUser();
  const auth = await getStaffAuth();
  const [events, tz, devices] = await Promise.all([
    prisma.activityLog.findMany({
      // Only the user's OWN auth events. Admin actions they performed
      // on others (invites, member edits, resets) are also `type:
      // "auth"` rows under their userId; those aren't account
      // activity and would crowd real sign-ins out of the 15-row cap.
      where: {
        userId,
        type: "auth",
        matterId: null,
        title: { in: Object.values(AUTH_EVENT_TITLES) },
      },
      orderBy: { timestamp: "desc" },
      take: HISTORY_LIMIT,
      select: { id: true, title: true, detail: true, timestamp: true },
    }),
    getCurrentUserTimeZone(),
    auth.status === "ok"
      ? listActiveStaffSessions(auth.clerkUserId)
      : Promise.resolve({ ok: false as const, error: "no session" }),
  ]);
  const currentSessionId = auth.status === "ok" ? auth.sessionId : null;

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div>
        <h1 className="text-base font-semibold text-ink">Security</h1>
        <p className="text-xs text-ink-3 mt-1">
          Where you&apos;re signed in and your recent sign-in activity.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            Signed-in devices
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {!devices.ok ? (
            <p className="text-xs text-ink-3">
              Couldn&apos;t load devices right now.
            </p>
          ) : (
            <SessionList
              sessions={devices.sessions.map((d) => ({
                id: d.id,
                browser: d.browser,
                device: d.device,
                location: d.location,
                lastActive: formatDate(d.lastActiveAt, "datetime", tz),
                isCurrent: d.id === currentSessionId,
              }))}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            Sign-in history
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {events.length === 0 ? (
            <EmptyState
              title="No activity recorded yet"
              description="Sign-ins and revoked sessions will appear here."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {events.map((e) => (
                <li key={e.id} className="py-2 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div
                      className={cn(
                        "text-xs font-medium",
                        /^(Failed|Blocked)/.test(e.title) ? "text-warn" : "text-ink"
                      )}
                    >
                      {e.title}
                    </div>
                    {e.detail && (
                      <div className="text-2xs text-ink-4 truncate">{e.detail}</div>
                    )}
                  </div>
                  <div className="text-2xs text-ink-4 shrink-0 font-mono">
                    {formatDate(e.timestamp, "datetime", tz)}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-2xs text-ink-4 mt-3">
            Don&apos;t recognize a device? Revoke it above.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
