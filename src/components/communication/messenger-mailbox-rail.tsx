/**
 * Messenger Mailbox Rail
 *
 * Left rail for the Messages view of /communication. Same pattern as
 * the email MailboxRail — filter pills with counts, deep-linkable via
 * `?view=messages&filter=…`. Server component.
 */

import Link from "next/link";
import { Inbox, MailOpen, FileQuestion, Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MessengerMailboxCounts } from "@/lib/queries/messenger";

export type MessengerFilter = "all" | "unread" | "unfiled" | "pinned";

const ITEMS: Array<{
  filter: MessengerFilter;
  label: string;
  icon: typeof Inbox;
}> = [
  { filter: "all", label: "All", icon: Inbox },
  { filter: "unread", label: "Unread", icon: MailOpen },
  { filter: "unfiled", label: "Unfiled", icon: FileQuestion },
  { filter: "pinned", label: "Pinned", icon: Pin },
];

function hrefFor(filter: MessengerFilter, threadId: string | null): string {
  const params = new URLSearchParams();
  params.set("view", "messages");
  if (filter !== "all") params.set("filter", filter);
  if (threadId) params.set("thread", threadId);
  return `/communication?${params.toString()}`;
}

export function MessengerMailboxRail({
  counts,
  activeFilter,
  selectedThreadId,
}: {
  counts: MessengerMailboxCounts;
  activeFilter: MessengerFilter;
  selectedThreadId: string | null;
}) {
  return (
    <aside className="flex w-48 shrink-0 border-r border-line bg-paper-2/30 flex-col py-3 h-full">
      {/* See `mailbox-rail.tsx` for the dual-mode pattern — rail
          renders as a persistent column at lg+ and is wrapped by
          `<MailboxDrawer>` for the slide-out at `<lg`. */}
      <div className="px-3 pb-1 text-2xs font-medium text-ink-3">Messages</div>
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
                  ? "bg-sidebar-accent text-ink font-medium"
                  : "text-ink-2 hover:bg-paper-2 hover:text-ink",
              )}
            >
              <Icon size={13} className={active ? "text-ink" : "text-ink-3"} />
              <span className="flex-1">{item.label}</span>
              {count > 0 && (
                <span
                  className={cn(
                    "text-2xs font-mono font-medium px-1.5 py-px rounded-lg border",
                    active
                      ? "bg-white text-ink border-line"
                      : "bg-paper-2 text-ink-3 border-transparent",
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
