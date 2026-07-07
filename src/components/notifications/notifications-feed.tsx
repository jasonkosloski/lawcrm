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
 * Note: "Mark all read" clears EVERY unread row server-side, not
 * just the visible page — locally we can only flip the rows we
 * have, which is fine because the other pages re-render read on
 * next fetch.
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
}: {
  initialRows: NotificationRow[];
  initialUnreadCount: number;
}) {
  const [rows, setRows] = useState(initialRows);
  const [unread, setUnread] = useState(initialUnreadCount);
  const [, startTransition] = useTransition();

  const handleMarkOne = (row: NotificationRow) => {
    if (row.isRead) return;
    setRows((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, isRead: true } : r))
    );
    setUnread((n) => Math.max(0, n - 1));
    startTransition(async () => {
      await markNotificationRead(row.id);
    });
  };

  const handleMarkAll = () => {
    setRows((prev) => prev.map((r) => ({ ...r, isRead: true })));
    setUnread(0);
    startTransition(async () => {
      await markAllNotificationsRead();
    });
  };

  return (
    <div className="rounded-md border border-line bg-white">
      <div className="border-b border-line px-3 py-2 flex items-center justify-between">
        <div className="text-2xs font-mono uppercase tracking-wider text-ink-4">
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
            <FeedRow key={r.id} row={r} onMarkRead={() => handleMarkOne(r)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FeedRow({
  row,
  onMarkRead,
}: {
  row: NotificationRow;
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
          <span title={formatDate(row.createdAt)}>
            {formatRelative(row.createdAt)}
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
      onClick={onMarkRead}
    >
      {row.link ? (
        // next/link for the same reason as the bell: a full-page
        // navigation would abort the in-flight mark-read action.
        <Link href={row.link} className="block">
          {inner}
        </Link>
      ) : (
        <div>{inner}</div>
      )}
    </li>
  );
}
