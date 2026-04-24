/**
 * Embedded Thread List
 *
 * Compact thread list for use inside matter or lead detail tabs. Each
 * row is a Link to the main inbox with the thread preselected
 * (`/communication?thread=<id>`) — clicking navigates out to the full
 * three-pane inbox where the reader takes the full width. Later we
 * could swap this for an in-place modal reader (calendar-event
 * pattern) without changing the query layer.
 */

import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import { Paperclip, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import type { ThreadListRow } from "@/lib/queries/communication";

export function EmbeddedThreadList({
  threads,
  emptyLabel,
  emptyHint,
  showMatterChip = true,
}: {
  threads: ThreadListRow[];
  emptyLabel: string;
  emptyHint?: string;
  /** When inside a matter tab, every thread is for that matter —
   *  suppress the matter chip for visual cleanliness. */
  showMatterChip?: boolean;
}) {
  if (threads.length === 0) {
    return (
      <Card>
        <div className="p-8 text-center flex flex-col items-center gap-2">
          <div className="text-sm font-semibold text-ink">{emptyLabel}</div>
          {emptyHint && (
            <div className="text-xs text-ink-3 max-w-md">{emptyHint}</div>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-0 overflow-hidden">
      <ul className="divide-y divide-line">
        {threads.map((t) => (
          <li key={t.id}>
            <Link
              href={`/communication?thread=${t.id}`}
              className={cn(
                "block px-4 py-3 transition-colors border-l-2 border-l-transparent",
                t.isRead
                  ? "hover:bg-brand-tint"
                  : "bg-brand-tint/40 hover:bg-brand-tint border-l-brand-500"
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
                <div className="text-2xs text-ink-4 truncate">{t.snippet}</div>
              )}
              <div className="flex items-center gap-2 mt-1.5">
                {showMatterChip && t.matter && (
                  <span className="inline-flex items-center gap-1 text-2xs font-mono text-ink-3">
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: t.matter.color }}
                    />
                    {t.matter.name}
                  </span>
                )}
                {showMatterChip && !t.matter && (
                  <span className="text-2xs font-medium text-warn">
                    Unfiled
                  </span>
                )}
                <span className="ml-auto flex items-center gap-1.5">
                  {t.hasAttachments && (
                    <Paperclip size={11} className="text-ink-4 shrink-0" />
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
        ))}
      </ul>
    </Card>
  );
}
