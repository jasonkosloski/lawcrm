/**
 * Notification Bell — topbar widget rendering the unread count
 * badge + a popover dropdown of recent rows.
 *
 * Data flow: self-fetches on mount via the `fetchBellState` server
 * action and polls every 60s. Re-fetches on dropdown open so the
 * popover view is always fresh when the user looks at it. Mark-
 * read calls update local state optimistically + server action in
 * the background.
 *
 * Visual: bell icon with a small red pip when unreadCount > 0.
 * Click opens a popover anchored to the icon (right-aligned, max
 * 22rem wide). Each row shows the type icon, title, optional
 * matter chip, body, and a relative timestamp.
 */

"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  Bell,
  BellDot,
  Calendar,
  CheckCircle2,
  CircleAlert,
  CircleX,
  ClipboardCheck,
  Coins,
  ListChecks,
  MessageSquare,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format-date";
import {
  fetchBellState,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/app/actions/notifications";
import type {
  NotificationRow,
  NotificationsBell,
} from "@/lib/queries/notifications";

const POLL_MS = 60_000;

const TYPE_ICON: Record<string, React.ComponentType<{ size?: number }>> = {
  task_assigned: ClipboardCheck,
  task_due_soon: ListChecks,
  deadline_approaching: CircleAlert,
  deadline_overdue: CircleX,
  settlement_step_approved: CheckCircle2,
  settlement_step_rejected: CircleX,
  invoice_payment_recorded: Coins,
  note_mentioned: MessageSquare,
  matter_assigned: UserPlus,
  generic: Calendar,
};

const TYPE_TONE: Record<string, string> = {
  task_assigned: "text-brand-700",
  task_due_soon: "text-warn",
  deadline_approaching: "text-warn",
  deadline_overdue: "text-warn",
  settlement_step_approved: "text-ok",
  settlement_step_rejected: "text-warn",
  invoice_payment_recorded: "text-ok",
  note_mentioned: "text-ink-3",
  matter_assigned: "text-brand-700",
  generic: "text-ink-3",
};

export function NotificationBell() {
  const [state, setState] = useState<NotificationsBell | null>(null);
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const popRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Initial fetch + interval poll. The `cancelled` guard prevents a
  // late response from a previous interval tick from clobbering a
  // newer state when the user navigates / unmounts mid-flight.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await fetchBellState();
        if (!cancelled) setState(next);
      } catch (err) {
        // Bell fetch failures are non-blocking — swallow; the
        // user's primary work doesn't depend on it.
        console.warn("[notification-bell] poll failed", err);
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

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
      if (e.key === "Escape") setOpen(false);
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
    // could be up to a minute stale. Fired OUTSIDE the setOpen
    // updater: updaters run during render and must stay pure —
    // startTransition inside one throws "Cannot call startTransition
    // while rendering" and React's updater re-invocation can loop.
    if (!open) {
      startTransition(async () => {
        const fresh = await fetchBellState();
        setState(fresh);
      });
    }
    setOpen((prev) => !prev);
  };

  const handleMarkOne = (row: NotificationRow) => {
    if (row.isRead) return;
    // Optimistic — flip the row locally + decrement badge before
    // the server confirms.
    setState((prev) =>
      prev
        ? {
            unreadCount: Math.max(0, prev.unreadCount - 1),
            recent: prev.recent.map((r) =>
              r.id === row.id ? { ...r, isRead: true } : r
            ),
          }
        : prev
    );
    startTransition(async () => {
      await markNotificationRead(row.id);
    });
  };

  const handleMarkAll = () => {
    setState((prev) =>
      prev
        ? {
            unreadCount: 0,
            recent: prev.recent.map((r) => ({ ...r, isRead: true })),
          }
        : prev
    );
    startTransition(async () => {
      await markAllNotificationsRead();
    });
  };

  const unread = state?.unreadCount ?? 0;
  const rows = state?.recent ?? [];
  const hasUnread = unread > 0;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={handleOpen}
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
            className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-warn text-white text-[10px] font-mono font-medium leading-4 text-center"
            aria-hidden="true"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={popRef}
          role="menu"
          className={cn(
            "absolute right-0 top-9 z-50 w-[22rem] max-h-[28rem] overflow-y-auto",
            "rounded-md border border-line bg-white shadow-md"
          )}
        >
          <div className="sticky top-0 bg-white border-b border-line px-3 py-2 flex items-center justify-between">
            <div className="text-2xs font-mono uppercase tracking-wider text-ink-4">
              Notifications
              {hasUnread && (
                <span className="ml-1.5 text-warn">{unread} unread</span>
              )}
            </div>
            {hasUnread && (
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
                  onMarkRead={() => handleMarkOne(r)}
                  onClose={() => setOpen(false)}
                />
              ))}
            </ul>
          )}
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
  const Icon = TYPE_ICON[row.type] ?? Calendar;
  const tone = TYPE_TONE[row.type] ?? "text-ink-3";

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
          <span>{formatRelative(row.createdAt)}</span>
        </div>
      </div>
      {!row.isRead && (
        <span
          aria-hidden="true"
          className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-brand-500"
          title="Unread"
        />
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
        "border-b border-line/60 last:border-b-0 hover:bg-paper-2 transition-colors cursor-pointer",
        !row.isRead && "bg-brand-tint/30"
      )}
      onClick={handleClick}
    >
      {row.link ? (
        // next/link, not a raw <a>: a full-page navigation would
        // unload the document and can abort the in-flight mark-read
        // server action fired in handleClick, leaving the row unread
        // server-side after the optimistic badge decrement. Client
        // navigation keeps the transition alive.
        <Link href={row.link} className="block">
          {inner}
        </Link>
      ) : (
        <div>{inner}</div>
      )}
    </li>
  );
}
