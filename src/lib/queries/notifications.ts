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
import { pageWindow } from "@/lib/pagination";
import { filterAccessibleMatterIds } from "@/lib/matter-access";

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

/** Shown in place of a notification whose matter the reader can no
 *  longer see (walled off after it was sent). Title/body were
 *  rendered at write time and can carry the matter name, amounts or
 *  task titles, so all of it goes — not just `matterName`. */
export const HIDDEN_MATTER_NOTIFICATION_TITLE =
  "Update on a matter you no longer have access to";

type NotificationDbRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  matterId: string | null;
  matter: { name: string } | null;
  createdAt: Date;
};

function toRow(
  r: NotificationDbRow,
  visible: Set<string>,
  isRead: boolean
): NotificationRow {
  const hidden = r.matterId !== null && !visible.has(r.matterId);
  return {
    id: r.id,
    type: r.type,
    title: hidden ? HIDDEN_MATTER_NOTIFICATION_TITLE : r.title,
    body: hidden ? null : r.body,
    link: hidden ? null : r.link,
    matterId: r.matterId,
    matterName: hidden ? null : (r.matter?.name ?? null),
    isRead,
    createdAt: r.createdAt,
  };
}
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
      include: { matter: { select: { id: true, name: true } } },
    }),
    prisma.notification.findMany({
      where: { userId, readAt: { not: null } },
      orderBy: { createdAt: "desc" },
      take: READ_TAIL,
      include: { matter: { select: { id: true, name: true } } },
    }),
    prisma.notification.count({
      where: { userId, readAt: null },
    }),
  ]);

  const visible = await filterAccessibleMatterIds(
    userId,
    [...unread, ...recentRead].flatMap((r) => (r.matterId ? [r.matterId] : []))
  );
  // Hidden matter: the notification exists, its contents do not leak.
  const map = (rows: typeof unread, isRead: boolean): NotificationRow[] =>
    rows.map((r) => toRow(r, visible, isRead));

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

  // Clamps junk / out-of-range ?page= values instead of 404ing.
  const { page: safePage, pageCount, skip } = pageWindow(
    total,
    page,
    NOTIFICATIONS_PAGE_SIZE
  );

  const rows = await prisma.notification.findMany({
    where: { userId },
    // `id` tiebreak keeps createMany-batched rows (same createdAt)
    // in a stable order across pages.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip,
    take: NOTIFICATIONS_PAGE_SIZE,
    include: { matter: { select: { id: true, name: true } } },
  });
  const visible = await filterAccessibleMatterIds(
    userId,
    rows.flatMap((r) => (r.matterId ? [r.matterId] : []))
  );

  return {
    rows: rows.map((r) => toRow(r, visible, r.readAt !== null)),
    page: safePage,
    pageCount,
    total,
    unreadCount,
    asOf,
  };
}
