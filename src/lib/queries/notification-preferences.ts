/**
 * Email notification settings — server-side reads for
 * /settings/notifications and the matter header mute toggle.
 */

import { prisma } from "@/lib/prisma";
import { matterAccessWhere } from "@/lib/matter-access";
import {
  NOTIFICATION_CATEGORIES,
  effectiveMode,
  type EmailMode,
  type NotificationCategory,
} from "@/lib/notification-categories";

export type NotificationEmailSettings = {
  modes: Record<NotificationCategory, EmailMode>;
  /** Muted matters the user can still see, by name. */
  mutedMatters: { id: string; name: string }[];
};

export async function getNotificationEmailSettings(
  userId: string
): Promise<NotificationEmailSettings> {
  const [prefs, mutes] = await Promise.all([
    prisma.notificationPreference.findMany({
      where: { userId },
      select: { category: true, emailMode: true },
    }),
    prisma.notificationMatterMute.findMany({
      where: { userId, matter: await matterAccessWhere(userId) },
      select: { matter: { select: { id: true, name: true } } },
      orderBy: { matter: { name: "asc" } },
    }),
  ]);
  const stored = new Map(prefs.map((p) => [p.category, p.emailMode]));
  const modes = Object.fromEntries(
    NOTIFICATION_CATEGORIES.map((c) => [c.key, effectiveMode(c.key, stored.get(c.key))])
  ) as Record<NotificationCategory, EmailMode>;
  return { modes, mutedMatters: mutes.map((m) => m.matter) };
}

export async function isMatterEmailMuted(
  userId: string,
  matterId: string
): Promise<boolean> {
  const hit = await prisma.notificationMatterMute.findUnique({
    where: { userId_matterId: { userId, matterId } },
    select: { userId: true },
  });
  return !!hit;
}
