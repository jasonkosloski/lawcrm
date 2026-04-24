/**
 * Thread List
 *
 * Middle pane. Server component — each row is a `<Link>` that writes
 * `?thread=<id>` to the URL while preserving the current `?filter=`,
 * so the reader pane updates server-side on click.
 */

import Link from "next/link";
import { Paperclip, Star } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { cn } from "@/lib/utils";
import type {
  CommunicationFilter,
  ThreadListRow,
} from "@/lib/queries/communication";

function rowHref(threadId: string, filter: CommunicationFilter): string {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("filter", filter);
  params.set("thread", threadId);
  return `/communication?${params.toString()}`;
}

export function ThreadList({
  threads,
  filter,
  selectedThreadId,
}: {
  threads: ThreadListRow[];
  filter: CommunicationFilter;
  selectedThreadId: string | null;
}) {
  return (
    <div className="w-90 shrink-0 border-r border-line bg-white flex flex-col min-h-0">
      <header className="px-4 py-3 border-b border-line shrink-0">
        <div className="text-2xs font-mono uppercase tracking-wider text-ink-4">
          {filter === "all"
            ? "Inbox"
            : filter === "unread"
              ? "Unread"
              : filter === "starred"
                ? "Starred"
                : "Unfiled"}
        </div>
        <div className="text-sm font-display font-medium text-ink">
          {threads.length} {threads.length === 1 ? "thread" : "threads"}
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
                href={rowHref(t.id, filter)}
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
