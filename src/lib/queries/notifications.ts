/**
 * Notifications queries — server-only.
 *
 * Drives the topbar bell + the /notifications feed page:
 *   - `getNotificationsBell()` — unread count for the badge plus
 *     a tail of recent rows (unread first, then the 5 most recent
 *     read ones for context). Capped so a busy account doesn't
 *     load a thousand rows just to render the dropdown.
 *   - `getNotificationsFeed(page)` — the full history, newest
 *     first, offset-paginated at NOTIFICATIONS_PAGE_SIZE per page.
 *
 * Both are per-user; we don't fan out across firm members here
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
  /** Created-at of the user's newest notification when this snapshot
   *  was read (DB clock). Pass it to `markAllNotificationsRead` so
   *  "mark all read" only clears what the user could have seen. */
  asOf?: Date | null;
  unreadCount: number;
  /** Recent rows for the dropdown — unread first, then the 5 most
   *  recent read entries for context. Capped at 20. */
  recent: NotificationRow[];
};

const RECENT_CAP = 20;
const READ_TAIL = 5;

/** createdAt of the user's newest notification — read BEFORE the
 *  list/count queries so anything inserted afterwards is newer than
 *  the cutoff (a conservative "mark all read" boundary). */
async function newestNotificationAt(userId: string): Promise<Date | null> {
  const row = await prisma.notification.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return row?.createdAt ?? null;
}

export async function getNotificationsBell(): Promise<NotificationsBell> {
  const userId = await getCurrentUserId();
  const asOf = await newestNotificationAt(userId);

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
    asOf,
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

// ── Full feed (/notifications) ─────────────────────────────────────────

export const NOTIFICATIONS_PAGE_SIZE = 50;

export type NotificationsFeed = {
  rows: NotificationRow[];
  /** 1-based, clamped into [1, pageCount]. */
  page: number;
  pageCount: number;
  total: number;
  unreadCount: number;
  /** See `NotificationsBell.asOf` — hand it to "Mark all read". */
  asOf: Date | null;
};

/** One page of the current user's full notification history, newest
 *  first. Simple offset pagination — a notifications feed is short-
 *  tailed enough that cursor stability isn't worth the ceremony. */
export async function getNotificationsFeed(
  page: number
): Promise<NotificationsFeed> {
  const userId = await getCurrentUserId();
  const asOf = await newestNotificationAt(userId);

  const [total, unreadCount] = await Promise.all([
    prisma.notification.count({ where: { userId } }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / NOTIFICATIONS_PAGE_SIZE));
  // Clamp junk / out-of-range ?page= values instead of 404ing.
  const safePage = Math.min(
    Math.max(1, Number.isFinite(page) ? Math.trunc(page) : 1),
    pageCount
  );

  const rows = await prisma.notification.findMany({
    where: { userId },
    // `id` tiebreak keeps createMany-batched rows (same createdAt)
    // in a stable order across pages.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (safePage - 1) * NOTIFICATIONS_PAGE_SIZE,
    take: NOTIFICATIONS_PAGE_SIZE,
    include: { matter: { select: { name: true } } },
  });

  return {
    rows: rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      body: r.body,
      link: r.link,
      matterId: r.matterId,
      matterName: r.matter?.name ?? null,
      isRead: r.readAt !== null,
      createdAt: r.createdAt,
    })),
    page: safePage,
    pageCount,
    total,
    unreadCount,
    asOf,
  };
}
