/**
 * Thread List
 *
 * Middle pane. Server component — each row is a `<Link>` that writes
 * `?thread=<id>` to the URL while preserving the current `?filter=`,
 * so the reader pane updates server-side on click.
 */

import Link from "next/link";
import { BellRing, Paperclip, Star } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { cn } from "@/lib/utils";
import type {
  CommunicationFilter,
  ThreadListRow,
} from "@/lib/queries/communication";
import { MailboxDrawerTrigger } from "./mailbox-drawer";

function rowHref(
  threadId: string,
  filter: CommunicationFilter,
  matterId: string | null
): string {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("filter", filter);
  if (matterId) params.set("matter", matterId);
  params.set("thread", threadId);
  return `/communication?${params.toString()}`;
}

const FILTER_LABEL: Record<CommunicationFilter, string> = {
  inbox: "Inbox",
  all: "All mail",
  unread: "Unread",
  starred: "Starred",
  unfiled: "Unfiled",
  filed: "On a matter",
  untimed: "Untimed (mine)",
};

export function ThreadList({
  threads,
  filter,
  matterId,
  matterLabel,
  selectedThreadId,
}: {
  threads: ThreadListRow[];
  filter: CommunicationFilter;
  /** When set, the rail's per-pinned-matter row is active; the
   *  thread-list header shows the matter name instead of the
   *  filter label, and per-row hrefs preserve the matter param. */
  matterId?: string | null;
  matterLabel?: string | null;
  selectedThreadId: string | null;
}) {
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
          <div className="text-2xs font-mono uppercase tracking-wider text-ink-4 truncate">
            {matterLabel ?? FILTER_LABEL[filter]}
          </div>
          <div className="text-sm font-display font-medium text-ink">
            {threads.length} {threads.length === 1 ? "thread" : "threads"}
          </div>
        </div>
      </header>

      <ul className="flex-1 overflow-y-auto">
        {threads.length === 0 ? (
          <li className="px-4 py-8 text-center text-xs text-ink-4">
            Nothing here.
          </li>
        ) : (
          threads.map((t) => (
            <li key={t.id}>
              <Link
                href={rowHref(t.id, filter, matterId ?? null)}
                scroll={false}
                className={cn(
                  "block px-4 py-3 border-b border-line transition-colors",
                  t.id === selectedThreadId
                    ? "bg-brand-soft border-l-2 border-l-brand-500"
                    : "hover:bg-brand-tint border-l-2 border-l-transparent"
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={cn(
                      "text-xs truncate flex-1 min-w-0",
                      t.isRead ? "text-ink-2" : "font-semibold text-ink"
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
                    {formatDistanceToNowStrict(t.lastMessageAt, {
                      addSuffix: false,
                    })
                      .replace(" hours", "h")
                      .replace(" hour", "h")
                      .replace(" minutes", "m")
                      .replace(" minute", "m")
                      .replace(" days", "d")
                      .replace(" day", "d")
                      .replace(" months", "mo")
                      .replace(" month", "mo")
                      .replace(" years", "y")
                      .replace(" year", "y")}
                  </span>
                </div>
                <div
                  className={cn(
                    "text-xs leading-tight truncate mb-0.5",
                    t.isRead ? "text-ink-3" : "text-ink font-medium"
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
                    <span className="inline-flex items-center gap-1 text-2xs font-mono text-ink-3">
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: t.matter.color }}
                      />
                      {t.matter.name}
                    </span>
                  )}
                  {!t.matter && (
                    <span className="text-2xs font-medium text-warn">
                      Unfiled
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-1.5">
                    {t.followUpAt && (
                      <span
                        title={`Follow up by ${t.followUpAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                        className={cn(
                          "inline-flex items-center gap-0.5 text-3xs font-mono px-1 rounded",
                          t.followUpAt.getTime() < Date.now()
                            ? "text-warn"
                            : "text-brand-700"
                        )}
                      >
                        <BellRing size={9} />
                        {t.followUpAt.getTime() < Date.now() - 24 * 60 * 60 * 1000
                          ? "Late"
                          : t.followUpAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    )}
                    {t.hasAttachments && (
                      <Paperclip
                        size={11}
                        className="text-ink-4 shrink-0"
                      />
                    )}
                    {t.isStarred && (
                      <Star
                        size={11}
                        className="text-warn fill-warn shrink-0"
                      />
                    )}
                  </span>
                </div>
              </Link>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
