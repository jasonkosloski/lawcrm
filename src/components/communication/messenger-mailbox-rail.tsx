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
    <aside className="w-48 shrink-0 border-r border-line bg-paper-2/30 flex flex-col py-3">
      <div className="px-3 pb-1 text-2xs font-mono uppercase tracking-wider text-ink-4">
        Messages
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
