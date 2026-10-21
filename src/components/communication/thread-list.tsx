/**
 * Thread List
 *
 * Middle pane. Server component — each row is a `<Link>` that writes
 * `?thread=<id>` to the URL while preserving the current `?filter=`,
 * so the reader pane updates server-side on click.
 */

import Link from "next/link";
import { BellRing, Inbox, Paperclip, Star } from "lucide-react";
import { cn, plural } from "@/lib/utils";
import { EmptyState } from "@/components/shared/empty-state";
// Centralized date formatting (ADR-012). `lastMessageAt` is a recency
// label (formatRelative is TZ-independent until its >30d calendar-date
// fallback, which uses the viewer's zone); `followUpAt` is a calendar
// day (the action stores end-of-day of the picked date), so it is
// read as a date-only value and compared by day against the viewer's
// today - never as an instant against Date.now().
import {
  daysUntilDateOnly,
  formatDateOnly,
  formatRelative,
} from "@/lib/format-date";
import type {
  CommunicationFilter,
  ThreadListRow,
} from "@/lib/queries/communication";
import { DEFAULT_COMMUNICATION_FILTER } from "@/lib/communication-filter-default";
import { MailboxDrawerTrigger } from "./mailbox-drawer";
import { ComposeEmailLauncher } from "./compose-email-launcher";
import { ThreadRowActions } from "./thread-row-actions";
import { Pager } from "@/components/shared/pager";
import type { Page } from "@/lib/pagination";

/** The filter the page falls back to when `?filter=` is absent
 *  (parseEmailFilter in communication/page.tsx; the rail's hrefFor
 *  omits only this one). Rows must emit `?filter=` for EVERY other
 *  filter - including "all" - or opening a thread resets the list. */
const DEFAULT_FILTER: CommunicationFilter = DEFAULT_COMMUNICATION_FILTER;

/** The list URL for a filter / matter drilldown, without a thread
 *  or page — the pager's base href. */
export function listHref(
  filter: CommunicationFilter,
  matterId: string | null
): string {
  const params = new URLSearchParams();
  if (filter !== DEFAULT_FILTER) params.set("filter", filter);
  if (matterId) params.set("matter", matterId);
  const qs = params.toString();
  return qs ? `/communication?${qs}` : "/communication";
}

/** A row's href: the list URL plus `?thread=`, keeping `?page=` so
 *  opening a thread on page 3 doesn't drop the list back to page 1. */
export function rowHref(
  threadId: string,
  filter: CommunicationFilter,
  matterId: string | null,
  page = 1
): string {
  const params = new URLSearchParams();
  if (filter !== DEFAULT_FILTER) params.set("filter", filter);
  if (matterId) params.set("matter", matterId);
  if (page > 1) params.set("page", String(page));
  params.set("thread", threadId);
  return `/communication?${params.toString()}`;
}

const FILTER_LABEL: Record<CommunicationFilter, string> = {
  inbox: "Inbox",
  all: "All mail",
  unread: "Unread",
  starred: "Starred",
  archived: "Archived",
  unfiled: "Unfiled",
  filed: "On a matter",
  untimed: "Untimed (mine)",
};

/** Follow-up chip: warn once the due day has passed, "Late" once it
 *  is more than a day behind (day arithmetic in the viewer's zone). */
function FollowUpChip({
  followUpAt,
  tz,
}: {
  followUpAt: Date;
  tz: string | null;
}) {
  const daysLeft = daysUntilDateOnly(followUpAt, tz ?? "UTC");
  return (
    <span
      title={`Follow up by ${formatDateOnly(followUpAt, "short")}`}
      className={cn(
        "inline-flex items-center gap-0.5 text-3xs font-mono px-1 rounded",
        daysLeft < 0 ? "text-warn" : "text-brand-700"
      )}
    >
      <BellRing size={9} />
      {daysLeft < -1 ? "Late" : formatDateOnly(followUpAt, "short")}
    </span>
  );
}

export function ThreadList({
  threads,
  filter,
  matterId,
  matterLabel,
  selectedThreadId,
  tz = null,
  paging,
}: {
  threads: ThreadListRow[];
  filter: CommunicationFilter;
  /** When set, the rail's per-pinned-matter row is active; the
   *  thread-list header shows the matter name instead of the
   *  filter label, and per-row hrefs preserve the matter param. */
  matterId?: string | null;
  matterLabel?: string | null;
  selectedThreadId: string | null;
  /** Viewer's IANA zone — anchors formatRelative's calendar-date
   *  fallback for threads older than ~30 days. */
  tz?: string | null;
  /** listThreads' page metadata; drives the header total and pager. */
  paging?: Pick<Page<unknown>, "page" | "pageCount" | "total" | "pageSize">;
}) {
  const page = paging?.page ?? 1;
  // Mobile drill-down: when a thread is selected, the reader takes
  // the whole viewport and the list hides. When no thread is
  // selected, the list takes the whole viewport and the reader
  // (which is just the placeholder anyway) hides. At lg+ both
  // panes coexist as before — the list is fixed at 90 (360px).
  return (
    <div
      className={
        (selectedThreadId ? "hidden lg:flex" : "flex w-full") +
        " lg:w-90 lg:shrink-0 border-r border-line bg-white flex-col min-h-0"
      }
    >
      <header className="flex items-center gap-2 px-3 sm:px-4 py-3 border-b border-line shrink-0">
        {/* Mobile: hamburger that opens the mailbox drawer (folders /
            filters / pinned matters). Hidden at lg+ where the rail
            is always visible. */}
        <MailboxDrawerTrigger
          label={matterLabel ?? FILTER_LABEL[filter]}
        />
        <div className="min-w-0 flex-1">
          <div className="text-2xs font-medium text-ink-3 truncate">
            {matterLabel ?? FILTER_LABEL[filter]}
          </div>
          <div className="text-sm font-display font-medium text-ink">
            {plural(paging?.total ?? threads.length, "thread")}
          </div>
        </div>
        {/* Compose — async server island: gates itself on
            communication.send_email + the user's connected accounts
            ("Connect Gmail" link when there are none). */}
        <ComposeEmailLauncher />
      </header>

      <ul className="flex-1 overflow-y-auto">
        {threads.length === 0 ? (
          <li>
            <EmptyState
              icon={Inbox}
              title="Nothing here"
              description="Threads matching this mailbox will appear here."
            />
          </li>
        ) : (
          threads.map((t) => (
            // `relative group` hosts the hover-reveal star/archive
            // cluster, which must be a SIBLING of the Link (no
            // interactive content inside an anchor).
            <li key={t.id} className="relative group">
              <Link
                href={rowHref(t.id, filter, matterId ?? null, page)}
                scroll={false}
                className={cn(
                  "block px-4 py-3 border-b border-line transition-colors",
                  t.id === selectedThreadId
                    ? "bg-paper-2 border-l-2 border-l-ink"
                    : "hover:bg-paper-2/60 border-l-2 border-l-transparent"
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={cn(
                      "text-sm truncate flex-1 min-w-0",
                      t.isRead ? "font-normal text-ink-2" : "font-semibold text-ink"
                    )}
                  >
                    {t.fromDisplay}
                  </span>
                  {t.messageCount > 1 && (
                    <span className="text-2xs font-mono text-ink-4 shrink-0">
                      {t.messageCount}
                    </span>
                  )}
                  <span className="text-2xs font-mono text-ink-4 shrink-0">
                    {formatRelative(t.lastMessageAt, tz)}
                  </span>
                </div>
                <div
                  className={cn(
                    "text-xs leading-tight truncate mb-0.5",
                    t.isRead ? "text-ink" : "text-ink font-medium"
                  )}
                >
                  {t.subject}
                </div>
                {t.snippet && (
                  <div className="text-2xs text-ink-4 truncate">
                    {t.snippet}
                  </div>
                )}
                <div className="flex items-center gap-2 mt-1.5">
                  {t.matter && (
                    <span className="inline-flex items-center gap-1 text-2xs text-ink-3">
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: t.matter.color }}
                      />
                      {t.matter.name}
                    </span>
                  )}
                  {t.lead && !t.matter && (
                    <span className="inline-flex items-center gap-1 text-2xs text-ink-3">
                      <span className="px-1 rounded border border-line text-ink-4">
                        Lead
                      </span>
                      {t.lead.name}
                    </span>
                  )}
                  {!t.matter && !t.lead && (
                    <span className="text-2xs font-medium text-warn">
                      Unfiled
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-1.5">
                    {t.followUpAt && (
                      <FollowUpChip followUpAt={t.followUpAt} tz={tz} />
                    )}
                    {t.hasAttachments && (
                      <Paperclip
                        size={11}
                        className="text-ink-4 shrink-0"
                      />
                    )}
                    {/* Static starred indicator (display only — the
                        toggle lives in the hover cluster). */}
                    {t.isStarred && (
                      <Star
                        size={11}
                        className="text-warn fill-warn shrink-0"
                      />
                    )}
                  </span>
                </div>
              </Link>
              <ThreadRowActions
                threadId={t.id}
                isStarred={t.isStarred}
                isArchived={t.isArchived}
              />
            </li>
          ))
        )}
      </ul>
      {paging && (
        <Pager
          {...paging}
          href={listHref(filter, matterId ?? null)}
          prevLabel="Newer"
          nextLabel="Older"
          className="px-3 py-2 border-t border-line shrink-0"
        />
      )}
    </div>
  );
}
