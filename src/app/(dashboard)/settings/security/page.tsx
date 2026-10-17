/**
 * /settings/security — the signed-in user's own account security.
 *
 * Identity-scoped like /settings/profile (no permission key): change
 * password, plus this user's recent sign-in activity read from the
 * `auth` rows in ActivityLog (src/lib/auth-events.ts). Firm-wide
 * auth events live on /settings/activity under "Security".
 *
 * Still to come: two-factor auth, a per-device session list,
 * password reset by email (needs an email delivery provider).
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { EmptyState } from "@/components/shared/empty-state";
import { AUTH_EVENT_TITLES } from "@/lib/auth-events";
import { requireUser } from "@/lib/current-user";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { formatDate } from "@/lib/format-date";
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/utils";

const HISTORY_LIMIT = 15;

export default async function SecuritySettingsPage() {
  const userId = await requireUser();
  const [events, tz] = await Promise.all([
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
  ]);

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div>
        <h1 className="text-base font-semibold text-ink">Security</h1>
        <p className="text-xs text-ink-3 mt-1">
          Your password and recent sign-in activity.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Change password</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <ChangePasswordForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            Recent account activity
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {events.length === 0 ? (
            <EmptyState
              title="No activity recorded yet"
              description="Sign-ins and password changes will appear here."
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
            Don&apos;t recognize something? Change your password: that signs
            out every other device.
          </p>
        </CardContent>
      </Card>

      <p className="text-2xs text-ink-4">
        Coming later: two-factor authentication, a per-device session
        list, and password reset by email.
      </p>
    </div>
  );
}
