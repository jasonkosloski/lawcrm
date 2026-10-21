/**
 * Messenger Thread List
 *
 * Middle pane for the Messages view. One row per conversation
 * (number), sorted by most-recent activity. Each row shows the
 * contact name (or raw number for unknowns), a one-line preview, the
 * relative timestamp, an unread badge, and the matter color dot when
 * filed. Selected thread is highlighted; clicking deep-links the
 * `?thread=…` param.
 */

import Link from "next/link";
import {
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  MessageSquare,
  Voicemail,
  Pin,
} from "lucide-react";
import { cn } from "@/lib/utils";
// Centralized recency label — TZ-independent until the >30d
// calendar-date fallback, which uses the viewer's zone.
import { formatRelative } from "@/lib/format-date";
import { formatPhone } from "@/lib/format-phone";
import { isMissedCall } from "@/lib/call-log-form";
import type { MessengerThreadRow } from "@/lib/queries/messenger";
import type { MessengerFilter } from "./messenger-mailbox-rail";
import { MailboxDrawerTrigger } from "./mailbox-drawer";
import { contactInitials } from "./contact-initials";
import { Pager } from "@/components/shared/pager";
import type { Page } from "@/lib/pagination";

const MESSENGER_FILTER_LABEL: Record<MessengerFilter, string> = {
  all: "All",
  unread: "Unread",
  unfiled: "Unfiled",
  pinned: "Pinned",
};

/** The list URL for a filter (no thread / page) — the pager's base. */
export function messengerListHref(filter: MessengerFilter): string {
  const params = new URLSearchParams();
  params.set("view", "messages");
  if (filter !== "all") params.set("filter", filter);
  return `/communication?${params.toString()}`;
}

/** A row's href; keeps `?page=` so opening a thread doesn't reset the
 *  list to page 1. */
export function messengerRowHref(
  threadId: string,
  filter: MessengerFilter,
  page = 1
): string {
  const params = new URLSearchParams();
  params.set("view", "messages");
  if (filter !== "all") params.set("filter", filter);
  if (page > 1) params.set("page", String(page));
  params.set("thread", threadId);
  return `/communication?${params.toString()}`;
}

/** Pick an icon for the last-item preview. Calls get directional
 *  (or missed) glyphs to match MatterPhoneLog's iconography. */
function previewIcon(
  kind: MessengerThreadRow["lastKind"],
  direction: MessengerThreadRow["lastDirection"],
  missed: boolean
) {
  if (kind === "voicemail") return <Voicemail size={11} className="text-ink-4" />;
  if (kind === "call") {
    if (missed) return <PhoneMissed size={11} className="text-warn" />;
    if (direction === "inbound")
      return <PhoneIncoming size={11} className="text-ink-4" />;
    return <PhoneOutgoing size={11} className="text-ink-4" />;
  }
  return <MessageSquare size={11} className="text-ink-4" />;
}

export function MessengerThreadList({
  threads,
  filter,
  selectedThreadId,
  action,
  tz = null,
  paging,
}: {
  threads: MessengerThreadRow[];
  filter: MessengerFilter;
  selectedThreadId: string | null;
  /** Optional header affordance — the "Log call" composer button. */
  action?: React.ReactNode;
  /** Viewer's IANA zone — anchors formatRelative's calendar-date
   *  fallback for threads older than ~30 days. */
  tz?: string | null;
  /** listMessengerThreads' page metadata; drives the total and pager. */
  paging?: Pick<Page<unknown>, "page" | "pageCount" | "total" | "pageSize">;
}) {
  const page = paging?.page ?? 1;
  const total = paging?.total ?? threads.length;
  // Mobile drill-down — same shape as the email ThreadList. When a
  // thread is selected the reader takes over; otherwise the list
  // takes the whole viewport. lg+ keeps the fixed 80 (320px) width.
  return (
    <div
      className={
        (selectedThreadId ? "hidden lg:flex" : "flex w-full") +
        " lg:w-80 lg:shrink-0 border-r border-line bg-white flex-col min-h-0"
      }
    >
      <div className="flex items-center gap-2 px-3 sm:px-4 py-3 border-b border-line shrink-0">
        <MailboxDrawerTrigger label={MESSENGER_FILTER_LABEL[filter]} />
        <div className="min-w-0 flex-1">
          <div className="text-2xs font-medium text-ink-3 truncate">
            {MESSENGER_FILTER_LABEL[filter]}
          </div>
          <div className="text-xs font-semibold text-ink">
            {total} {total === 1 ? "conversation" : "conversations"}
          </div>
        </div>
        {action}
      </div>

      {threads.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-6 text-center">
          <div className="text-2xs text-ink-4 leading-relaxed max-w-[15rem]">
            {filter === "all"
              ? "No conversations yet. Inbound texts and calls from the firm number will appear here once Quo is connected."
              : `No ${filter} conversations.`}
          </div>
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto">
          {threads.map((t) => {
            const active = t.id === selectedThreadId;
            // Real status check — which statuses count as "missed"
            // (and why busy/failed don't) is documented on
            // MISSED_CALL_STATUSES in @/lib/queries/messenger.
            const missedCall =
              t.lastKind === "call" &&
              isMissedCall(t.lastDirection, t.lastCallStatus);
            return (
              <li key={t.id}>
                <Link
                  href={messengerRowHref(t.id, filter, page)}
                  className={cn(
                    "flex items-start gap-3 px-4 py-2.5 border-b border-line transition-colors",
                    active
                      ? "bg-paper-2 shadow-[inset_2px_0_0_var(--color-ink)]"
                      : "hover:bg-paper-2/60 bg-white"
                  )}
                >
                  {/* Avatar / matter color dot */}
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-2xs font-mono font-medium shrink-0 border"
                    style={{
                      background: t.defaultMatterColor
                        ? `${t.defaultMatterColor}1a`
                        : "var(--color-paper-2)",
                      borderColor: t.defaultMatterColor ?? "var(--color-line)",
                      color: t.defaultMatterColor ?? "var(--color-ink-3)",
                    }}
                  >
                    {contactInitials(t.contactName)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {t.isPinned && (
                        <Pin size={10} className="text-ink-4 shrink-0" />
                      )}
                      <span
                        className={cn(
                          "text-xs truncate",
                          t.unreadCount > 0
                            ? "font-semibold text-ink"
                            : "font-medium text-ink"
                        )}
                      >
                        {t.contactName ?? (formatPhone(t.contactPhone) || t.contactPhone)}
                      </span>
                      <span className="ml-auto text-2xs font-mono text-ink-4 shrink-0">
                        {formatRelative(t.lastAt, tz)}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 mt-0.5">
                      {previewIcon(t.lastKind, t.lastDirection, missedCall)}
                      <span
                        className={cn(
                          "text-2xs truncate",
                          missedCall
                            ? "text-warn"
                            : t.unreadCount > 0
                              ? "text-ink-2 font-medium"
                              : "text-ink-3"
                        )}
                      >
                        {t.lastBody ?? "—"}
                      </span>
                      {t.unreadCount > 0 && (
                        <span className="ml-auto text-3xs font-mono font-medium px-1.5 rounded-full bg-brand-700 text-white shrink-0">
                          {t.unreadCount}
                        </span>
                      )}
                    </div>

                    {t.defaultMatterName && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ background: t.defaultMatterColor ?? "var(--color-ink-3)" }}
                        />
                        <span className="text-3xs text-ink-4 truncate">
                          {t.defaultMatterName}
                        </span>
                      </div>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {paging && (
        <Pager
          {...paging}
          href={messengerListHref(filter)}
          prevLabel="Newer"
          nextLabel="Older"
          className="px-3 py-2 border-t border-line shrink-0"
        />
      )}
    </div>
  );
}
