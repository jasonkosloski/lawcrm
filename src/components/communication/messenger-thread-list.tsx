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
import { formatDistanceToNowStrict } from "date-fns";
import {
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  MessageSquare,
  Voicemail,
  Pin,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  isMissedCall,
  type MessengerThreadRow,
} from "@/lib/queries/messenger";
import type { MessengerFilter } from "./messenger-mailbox-rail";
import { MailboxDrawerTrigger } from "./mailbox-drawer";

const MESSENGER_FILTER_LABEL: Record<MessengerFilter, string> = {
  all: "All",
  unread: "Unread",
  unfiled: "Unfiled",
  pinned: "Pinned",
};

function hrefFor(threadId: string, filter: MessengerFilter): string {
  const params = new URLSearchParams();
  params.set("view", "messages");
  if (filter !== "all") params.set("filter", filter);
  params.set("thread", threadId);
  return `/communication?${params.toString()}`;
}

/** Format a phone number lightly: +13035551234 → (303) 555-1234. */
function prettyPhone(p: string): string {
  const digits = p.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return p;
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
}: {
  threads: MessengerThreadRow[];
  filter: MessengerFilter;
  selectedThreadId: string | null;
  /** Optional header affordance — the "Log call" composer button. */
  action?: React.ReactNode;
}) {
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
          <div className="text-2xs font-mono uppercase tracking-wider text-ink-4 truncate">
            {MESSENGER_FILTER_LABEL[filter]}
          </div>
          <div className="text-xs font-semibold text-ink">
            {threads.length}{" "}
            {threads.length === 1 ? "conversation" : "conversations"}
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
                  href={hrefFor(t.id, filter)}
                  className={cn(
                    "flex items-start gap-3 px-4 py-2.5 border-b border-line transition-colors",
                    active
                      ? "bg-brand-50"
                      : "hover:bg-paper-2 bg-white"
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
                    {(t.contactName ?? "?")
                      .split(/\s+/)
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((s) => s[0]?.toUpperCase() ?? "")
                      .join("") || "?"}
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
                        {t.contactName ?? prettyPhone(t.contactPhone)}
                      </span>
                      <span className="ml-auto text-2xs font-mono text-ink-4 shrink-0">
                        {formatDistanceToNowStrict(t.lastAt, { addSuffix: false })}
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
                        <span className="ml-auto text-3xs font-mono font-medium px-1.5 rounded-full bg-brand-500 text-white shrink-0">
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
                        <span className="text-3xs font-mono uppercase tracking-wider text-ink-4 truncate">
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
    </div>
  );
}
