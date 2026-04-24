/**
 * Mailbox Rail
 *
 * Left-rail filter pills for the Communication page. Each entry is a
 * `<Link>` to the same page with a different `?filter=` param so the
 * whole thing is deep-linkable and back-button-honest.
 *
 * Server component — no interactivity beyond navigation. Counts come
 * from `getCommunicationCounts()`.
 */

import Link from "next/link";
import { Inbox, MailOpen, Star, FileQuestion } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  CommunicationCounts,
  CommunicationFilter,
} from "@/lib/queries/communication";

const ITEMS: Array<{
  filter: CommunicationFilter;
  label: string;
  icon: typeof Inbox;
}> = [
  { filter: "all", label: "All", icon: Inbox },
  { filter: "unread", label: "Unread", icon: MailOpen },
  { filter: "starred", label: "Starred", icon: Star },
  { filter: "unfiled", label: "Unfiled", icon: FileQuestion },
];

function hrefFor(filter: CommunicationFilter, threadId: string | null): string {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("filter", filter);
  // Keep the selected thread across filter changes when the thread
  // exists in the new filter set (server re-renders and handles the
  // case when it doesn't by showing the reader's empty state).
  if (threadId) params.set("thread", threadId);
  const qs = params.toString();
  return qs ? `/communication?${qs}` : "/communication";
}

export function MailboxRail({
  counts,
  activeFilter,
  selectedThreadId,
}: {
  counts: CommunicationCounts;
  activeFilter: CommunicationFilter;
  selectedThreadId: string | null;
}) {
  return (
    <aside className="w-48 shrink-0 border-r border-line bg-paper-2/30 flex flex-col py-3">
      <div className="px-3 pb-1 text-2xs font-mono uppercase tracking-wider text-ink-4">
        Mailboxes
      </div>
      <nav className="flex flex-col gap-px px-1.5">
        {ITEMS.map((item) => {
          const active = activeFilter === item.filter;
          const count = counts[item.filter];
          const Icon = item.icon;
          return (
            <Link
              key={item.filter}
              href={hrefFor(item.filter, selectedThreadId)}
              className={cn(
                "flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors",
                active
                  ? "bg-brand-500 text-white"
                  : "text-ink-2 hover:bg-[#eaf0f5] hover:text-brand-700"
              )}
            >
              <Icon
                size={13}
                className={active ? "text-white" : "text-ink-3"}
              />
              <span className="flex-1">{item.label}</span>
              {count > 0 && (
                <span
                  className={cn(
                    "text-2xs font-mono font-medium px-1.5 py-px rounded-lg border",
                    active
                      ? "bg-white/[.18] text-white border-transparent"
                      : "bg-brand-50 text-brand-700 border-brand-100"
                  )}
                >
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
