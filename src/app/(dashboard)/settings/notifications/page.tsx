/**
 * /settings/notifications — the signed-in user's email notification
 * settings. Identity-scoped like /settings/security (no permission
 * key). Everything still appears in the bell; this page chooses what
 * also reaches email (src/lib/notification-email.ts sends it).
 */

import { NotificationEmailSettings } from "@/components/settings/notification-email-settings";
import { requireUser } from "@/lib/current-user";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { getNotificationEmailSettings } from "@/lib/queries/notification-preferences";

export default async function NotificationsSettingsPage() {
  const userId = await requireUser();
  const [settings, timeZone] = await Promise.all([
    getNotificationEmailSettings(userId),
    getCurrentUserTimeZone(),
  ]);

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div>
        <h1 className="text-base font-semibold text-ink">Notifications</h1>
        <p className="text-xs text-ink-3 mt-1">
          Everything still appears in the bell. Choose what also reaches your email.
        </p>
      </div>
      <NotificationEmailSettings
        modes={settings.modes}
        mutedMatters={settings.mutedMatters}
        timeZone={timeZone}
      />
    </div>
  );
}
