/**
 * Notifications — full feed page.
 *
 * The bell dropdown shows a 20-row tail; this is the whole history,
 * newest first, offset-paginated at 50/page via `?page=N`. Reached
 * from the "View all notifications" footer in the bell.
 *
 * Auth: identity-scoped (the query reads the CURRENT user's rows
 * only) — no permission key, same reasoning as the mark-read
 * actions in `src/app/actions/notifications.ts`.
 *
 * Next.js 16: `searchParams` is a Promise that must be awaited.
 */

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { TopBar } from "@/components/layout/topbar";
import { NotificationsFeed } from "@/components/notifications/notifications-feed";
import { cn } from "@/lib/utils";
import {
  getNotificationsFeed,
  NOTIFICATIONS_PAGE_SIZE,
} from "@/lib/queries/notifications";

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const feed = await getNotificationsFeed(Number(sp.page ?? "1"));

  const rangeStart = (feed.page - 1) * NOTIFICATIONS_PAGE_SIZE + 1;
  const rangeEnd = Math.min(feed.total, feed.page * NOTIFICATIONS_PAGE_SIZE);

  return (
    <>
      <TopBar title="Notifications" crumbs="You · Notifications" />

      <div className="flex-1 overflow-y-auto p-3 sm:p-5 animate-page-enter">
        <div className="max-w-3xl mx-auto flex flex-col gap-3">
          <NotificationsFeed
            // Key on page so navigating resets the client component's
            // optimistic local state to the fresh server rows.
            key={feed.page}
            initialRows={feed.rows}
            initialUnreadCount={feed.unreadCount}
          />

          {/* Pager — only when there's more than one page. */}
          {feed.pageCount > 1 && (
            <div className="flex items-center justify-between text-2xs font-mono text-ink-4">
              <PagerLink
                href={`/notifications?page=${feed.page - 1}`}
                disabled={feed.page <= 1}
              >
                <ChevronLeft size={12} />
                Newer
              </PagerLink>
              <span>
                {rangeStart}–{rangeEnd} of {feed.total} · page {feed.page}/
                {feed.pageCount}
              </span>
              <PagerLink
                href={`/notifications?page=${feed.page + 1}`}
                disabled={feed.page >= feed.pageCount}
              >
                Older
                <ChevronRight size={12} />
              </PagerLink>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function PagerLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const cls = cn(
    "inline-flex items-center gap-1 px-2 py-1 rounded-md border",
    disabled
      ? "border-line/60 text-ink-4/60 cursor-default"
      : "border-line-2 bg-white text-ink-3 hover:border-brand-300 hover:text-brand-700 transition-colors"
  );
  if (disabled) {
    return (
      <span className={cls} aria-disabled="true">
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}
