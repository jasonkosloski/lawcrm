/**
 * Notifications queries — server-only.
 *
 * Drives the topbar bell:
 *   - `getNotificationsBell()` — unread count for the badge plus
 *     a tail of recent rows (unread first, then the 5 most recent
 *     read ones for context). Capped so a busy account doesn't
 *     load a thousand rows just to render the dropdown.
 *
 * The bell is per-user; we don't fan out across firm members here
 * — fan-out lives in the writer (`createNotifications`).
 */

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";

export type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  matterId: string | null;
  matterName: string | null;
  isRead: boolean;
  createdAt: Date;
};

export type NotificationsBell = {
  unreadCount: number;
  /** Recent rows for the dropdown — unread first, then the 5 most
   *  recent read entries for context. Capped at 20. */
  recent: NotificationRow[];
};

const RECENT_CAP = 20;
const READ_TAIL = 5;

export async function getNotificationsBell(): Promise<NotificationsBell> {
  const userId = await getCurrentUserId();

  const [unread, recentRead, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId, readAt: null },
      orderBy: { createdAt: "desc" },
      take: RECENT_CAP,
      include: { matter: { select: { name: true } } },
    }),
    prisma.notification.findMany({
      where: { userId, readAt: { not: null } },
      orderBy: { createdAt: "desc" },
      take: READ_TAIL,
      include: { matter: { select: { name: true } } },
    }),
    prisma.notification.count({
      where: { userId, readAt: null },
    }),
  ]);

  const map = (rows: typeof unread, isRead: boolean): NotificationRow[] =>
    rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      body: r.body,
      link: r.link,
      matterId: r.matterId,
      matterName: r.matter?.name ?? null,
      isRead,
      createdAt: r.createdAt,
    }));

  return {
    unreadCount,
    // Unread first (visually distinct in the dropdown), then a tail
    // of read rows so the dropdown doesn't go empty for a brand-new
    // catch-up but also doesn't bury fresh items.
    recent: [...map(unread, false), ...map(recentRead, true)].slice(
      0,
      RECENT_CAP
    ),
  };
}
