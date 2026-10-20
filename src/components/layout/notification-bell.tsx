/**
 * Notification Bell — topbar widget rendering the unread count
 * badge + a popover dropdown of recent rows.
 *
 * Data flow: state lives in the shell-level NotificationBellProvider
 * (see notification-bell-provider.tsx) so it survives navigation —
 * each page renders its own TopBar, and this component remounts with
 * it. The provider polls (visible tabs only) via a GET route handler;
 * this component re-fetches on dropdown open so the popover is always
 * fresh when the user looks at it. Mark-read updates optimistically
 * and the provider reconciles with the server.
 *
 * Visual: bell icon with a small red pip when unreadCount > 0.
 * Click opens a popover anchored to the icon (right-aligned, max
 * 22rem wide). Each row shows the type icon, title, optional
 * matter chip, body, and a relative timestamp.
 *
 * A11y: the popover is a labelled dialog (not a `menu` — it holds
 * rows and links, not menuitems); the trigger exposes aria-expanded;
 * unread rows say "Unread" to screen readers, and linkless unread
 * rows are real buttons.
 */

"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Bell, BellDot } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format-date";
// Icon + tone per type live in the shared meta so the /notifications
// feed page renders rows identically to the dropdown.
import { notificationTypeMeta } from "@/lib/notification-type-meta";
import { useUserTimeZone } from "@/components/user-time-zone";
import type { NotificationRow } from "@/lib/queries/notifications";
import { useNotificationBell } from "./notification-bell-provider";

export function NotificationBell() {
  const { state, error, refresh, markOne, markAll } = useNotificationBell();
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popId = useId();

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      // A nested popup that already handled this Escape wins.
      if (e.key !== "Escape" || e.defaultPrevented) return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleOpen = () => {
    // Re-fetch on open so the dropdown view is fresh — the 60s poll
    // could be up to a minute stale. Fired from the handler, never
    // inside the setOpen updater (updaters run during render and
    // must stay pure).
    if (!open) void refresh();
    setOpen((prev) => !prev);
  };

  const unread = state?.unreadCount ?? 0;
  const rows = state?.recent ?? [];
  const hasUnread = unread > 0;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={handleOpen}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? popId : undefined}
        aria-label={
          hasUnread ? `Notifications (${unread} unread)` : "Notifications"
        }
        title="Notifications"
        className={cn(
          "relative inline-flex items-center justify-center w-7 h-7 rounded-md",
          "border border-line-2 bg-white text-ink-3",
          "hover:border-brand-300 hover:text-brand-700 transition-colors",
          open && "border-brand-300 text-brand-700"
        )}
      >
        {hasUnread ? <BellDot size={14} /> : <Bell size={14} />}
        {hasUnread && (
          <span
            className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-warn text-white text-3xs font-mono font-medium leading-4 text-center"
            aria-hidden="true"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={popRef}
          id={popId}
          role="dialog"
          aria-label="Notifications"
          className={cn(
            "absolute right-0 top-9 z-50 w-[22rem] max-h-[28rem] overflow-y-auto",
            "rounded-md border border-line bg-white shadow-md"
          )}
        >
          <div className="sticky top-0 bg-white border-b border-line px-3 py-2 flex items-center justify-between">
            <div className="text-2xs font-medium text-ink-3">
              Notifications
              {hasUnread && (
                <span className="ml-1.5 text-warn">{unread} unread</span>
              )}
            </div>
            {hasUnread && (
              <button
                type="button"
                onClick={markAll}
                className="text-2xs text-ink-3 hover:text-ink underline-offset-2 hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          {error && (
            <div
              role="alert"
              className="px-3 py-2 text-2xs text-warn bg-warn-soft border-b border-line"
            >
              {error}
            </div>
          )}

          {rows.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <Bell
                size={20}
                className="mx-auto text-ink-4 mb-2"
                aria-hidden="true"
              />
              <div className="text-xs text-ink-3">No notifications yet.</div>
              <div className="text-2xs text-ink-4 mt-0.5">
                Deadlines, task assignments, and settlement updates land here.
              </div>
            </div>
          ) : (
            <ul>
              {rows.map((r) => (
                <NotificationRowItem
                  key={r.id}
                  row={r}
                  onMarkRead={() => markOne(r)}
                  onClose={() => setOpen(false)}
                />
              ))}
            </ul>
          )}

          {/* Footer — jump to the full paginated feed. Sticky so it
              stays reachable when the dropdown scrolls. */}
          <div className="sticky bottom-0 bg-white border-t border-line px-3 py-2 text-center">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="text-2xs font-medium text-brand-700 hover:underline underline-offset-2"
            >
              View all notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationRowItem({
  row,
  onMarkRead,
  onClose,
}: {
  row: NotificationRow;
  onMarkRead: () => void;
  onClose: () => void;
}) {
  const { icon: Icon, tone } = notificationTypeMeta(row.type);
  // Older rows fall back to a calendar date — in the profile zone.
  const tz = useUserTimeZone();

  const inner = (
    <div className="flex items-start gap-2.5 py-2 px-3">
      <div
        className={cn(
          "shrink-0 mt-0.5 w-6 h-6 rounded-md flex items-center justify-center bg-paper-2",
          tone
        )}
      >
        <Icon size={13} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-ink leading-snug">{row.title}</div>
        {row.body && (
          <div className="text-2xs text-ink-3 leading-snug mt-0.5 line-clamp-2">
            {row.body}
          </div>
        )}
        <div className="flex items-center gap-2 mt-1 text-2xs text-ink-4 font-mono">
          {row.matterName && (
            <span className="px-1.5 py-px rounded-full border border-line bg-paper-2 truncate max-w-[10rem]">
              {row.matterName}
            </span>
          )}
          <span>{formatRelative(row.createdAt, tz)}</span>
        </div>
      </div>
      {!row.isRead && (
        <>
          <span
            aria-hidden="true"
            className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-brand-500"
            title="Unread"
          />
          <span className="sr-only">Unread</span>
        </>
      )}
    </div>
  );

  const handleClick = () => {
    onMarkRead();
    if (row.link) onClose();
  };

  return (
    <li
      className={cn(
        "border-b border-line/60 last:border-b-0 hover:bg-paper-2 transition-colors",
        !row.isRead && "bg-brand-tint/30"
      )}
    >
      {row.link ? (
        // next/link, not a raw <a>: a full-page navigation would
        // unload the document and can abort the in-flight mark-read
        // server action fired in handleClick, leaving the row unread
        // server-side after the optimistic badge decrement. Client
        // navigation keeps the transition alive.
        <Link href={row.link} className="block" onClick={handleClick}>
          {inner}
        </Link>
      ) : row.isRead ? (
        <div>{inner}</div>
      ) : (
        // Linkless unread rows are real buttons so keyboard users can
        // mark them read too (a clickable <li> isn't focusable).
        <button
          type="button"
          onClick={handleClick}
          className="block w-full text-left cursor-pointer"
        >
          {inner}
        </button>
      )}
    </li>
  );
}
