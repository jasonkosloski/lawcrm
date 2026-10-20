/**
 * Notifications feed — client list for the /notifications page.
 *
 * The server page fetches one page of rows (newest first) and hands
 * them here; this component owns the interactive layer: optimistic
 * mark-read on row click, "Mark all read" for the whole account, and
 * the unread counter that both of those flip immediately. Same
 * optimistic-then-server-action pattern as the bell dropdown; icons
 * and tones come from the shared NOTIFICATION_TYPE_META so a row
 * looks identical in both surfaces.
 *
 * Note: "Mark all read" clears every unread row server-side up to the
 * `asOf` cutoff the page was rendered with — not just the visible
 * page, but also not anything that arrived after the user last
 * looked. Locally we can only flip the rows we have, which is fine
 * because the other pages re-render read on next fetch.
 *
 * Failures: the optimistic update is rolled back (and a message
 * shown) when the server action throws or reports !ok, instead of
 * letting the error escape the transition to the error boundary.
 *
 * Times render in the viewer's PROFILE zone (`tz`), not the runtime's,
 * so server render and hydration agree.
 */

"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/shared/empty-state";
import { formatDate, formatRelative } from "@/lib/format-date";
import { notificationTypeMeta } from "@/lib/notification-type-meta";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/app/actions/notifications";
import type { NotificationRow } from "@/lib/queries/notifications";

export function NotificationsFeed({
  initialRows,
  initialUnreadCount,
  tz,
  asOf = null,
}: {
  initialRows: NotificationRow[];
  initialUnreadCount: number;
  /** Viewer's IANA zone (getCurrentUserTimeZone() in the page). */
  tz: string;
  /** Server-side cutoff for "Mark all read" (see getNotificationsFeed). */
  asOf?: Date | null;
}) {
  const [rows, setRows] = useState(initialRows);
  const [unread, setUnread] = useState(initialUnreadCount);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  /** Undo an optimistic mark-read: put the given rows back to unread
   *  and restore the counter. Only the affected rows are touched, so
   *  a concurrent click on another row isn't clobbered. */
  const rollback = (ids: Set<string>, restoreUnread: (n: number) => number) => {
    setRows((prev) =>
      prev.map((r) => (ids.has(r.id) ? { ...r, isRead: false } : r))
    );
    setUnread(restoreUnread);
    setError("Couldn't update your notifications. Please try again.");
  };

  const handleMarkOne = (row: NotificationRow) => {
    if (row.isRead) return;
    setError(null);
    setRows((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, isRead: true } : r))
    );
    setUnread((n) => Math.max(0, n - 1));
    startTransition(async () => {
      try {
        const res = await markNotificationRead(row.id);
        if (!res.ok) throw new Error("mark-read refused");
      } catch (err) {
        console.warn("[notifications-feed] mark-read failed", err);
        rollback(new Set([row.id]), (n) => n + 1);
      }
    });
  };

  const handleMarkAll = () => {
    const wasUnread = new Set(rows.filter((r) => !r.isRead).map((r) => r.id));
    const unreadBefore = unread;
    setError(null);
    setRows((prev) => prev.map((r) => ({ ...r, isRead: true })));
    setUnread(0);
    startTransition(async () => {
      try {
        const res = await markAllNotificationsRead(asOf);
        if (!res.ok) throw new Error("mark-all-read refused");
      } catch (err) {
        console.warn("[notifications-feed] mark-all-read failed", err);
        rollback(wasUnread, () => unreadBefore);
      }
    });
  };

  return (
    <div className="rounded-md border border-line bg-white">
      <div className="border-b border-line px-3 py-2 flex items-center justify-between">
        <div className="text-2xs font-medium text-ink-3">
          {unread > 0 ? (
            <span className="text-warn">{unread} unread</span>
          ) : (
            "All caught up"
          )}
        </div>
        {unread > 0 && (
          <button
            type="button"
            onClick={handleMarkAll}
            className="text-2xs text-ink-3 hover:text-ink underline-offset-2 hover:underline"
          >
            Mark all read
          </button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="border-b border-line px-3 py-2 text-2xs text-warn"
        >
          {error}
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No notifications yet"
          description="Deadlines, task assignments, and settlement updates land here."
          className="py-12"
        />
      ) : (
        <ul>
          {rows.map((r) => (
            <FeedRow
              key={r.id}
              row={r}
              tz={tz}
              onMarkRead={() => handleMarkOne(r)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function FeedRow({
  row,
  tz,
  onMarkRead,
}: {
  row: NotificationRow;
  tz: string;
  onMarkRead: () => void;
}) {
  const { icon: Icon, tone } = notificationTypeMeta(row.type);

  const inner = (
    <div className="flex items-start gap-3 py-2.5 px-3">
      <div
        className={cn(
          "shrink-0 mt-0.5 w-7 h-7 rounded-md flex items-center justify-center bg-paper-2",
          tone
        )}
      >
        <Icon size={14} />
      </div>
      <div className="flex-1 min-w-0">
        <div
          className={cn(
            "text-xs leading-snug",
            row.isRead ? "text-ink-2" : "text-ink font-medium"
          )}
        >
          {row.title}
        </div>
        {row.body && (
          <div className="text-2xs text-ink-3 leading-snug mt-0.5 line-clamp-2">
            {row.body}
          </div>
        )}
        <div className="flex items-center gap-2 mt-1 text-2xs text-ink-4 font-mono">
          {row.matterName && (
            <span className="px-1.5 py-px rounded-full border border-line bg-paper-2 truncate max-w-[14rem]">
              {row.matterName}
            </span>
          )}
          {/* "5m ago" reads the clock, so server and client can differ
              at a minute boundary — that mismatch is expected. */}
          <span
            title={formatDate(row.createdAt, "medium", tz)}
            suppressHydrationWarning
          >
            {formatRelative(row.createdAt, tz)}
          </span>
        </div>
      </div>
      {!row.isRead && (
        <span
          aria-hidden="true"
          className="shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full bg-brand-500"
          title="Unread"
        />
      )}
    </div>
  );

  return (
    <li
      className={cn(
        "border-b border-line/60 last:border-b-0 hover:bg-paper-2 transition-colors",
        !row.isRead && "bg-brand-tint/30",
        (row.link || !row.isRead) && "cursor-pointer"
      )}
      // Linked rows: the click bubbles up from the (focusable) Link.
      // Link-less rows get their own button below so keyboard and
      // screen-reader users can mark them read too.
      onClick={row.link ? onMarkRead : undefined}
    >
      {row.link ? (
        // next/link for the same reason as the bell: a full-page
        // navigation would abort the in-flight mark-read action.
        <Link href={row.link} className="block">
          {inner}
        </Link>
      ) : (
        <button
          type="button"
          onClick={onMarkRead}
          disabled={row.isRead}
          // No aria-label: it would replace the content-derived name
          // and hide the body/matter/time from screen readers.
          className="block w-full text-left disabled:cursor-default"
        >
          {inner}
        </button>
      )}
    </li>
  );
}
