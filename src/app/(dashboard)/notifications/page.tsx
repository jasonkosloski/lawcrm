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

import { TopBar } from "@/components/layout/topbar";
import { NotificationsFeed } from "@/components/notifications/notifications-feed";
import { Pager } from "@/components/shared/pager";
import { parsePageParam } from "@/lib/pagination";
import {
  getNotificationsFeed,
  NOTIFICATIONS_PAGE_SIZE,
} from "@/lib/queries/notifications";
import { requireUser } from "@/lib/current-user";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const [feed, tz] = await Promise.all([
    getNotificationsFeed(parsePageParam(sp.page)),
    getCurrentUserTimeZone(),
  ]);

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
            tz={tz}
            asOf={feed.asOf}
          />

          <Pager
            page={feed.page}
            pageCount={feed.pageCount}
            total={feed.total}
            pageSize={NOTIFICATIONS_PAGE_SIZE}
            href="/notifications"
            prevLabel="Newer"
            nextLabel="Older"
          />
        </div>
      </div>
    </>
  );
}
