/**
 * Portal Thread List
 *
 * The firm-wide "Client portal" view on /communication: one row per
 * matter that has portal messages, awaiting-reply first. A plain list
 * (no reader pane); each row opens the matter's Portal channel, where
 * the conversation is read and answered.
 */

import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format-date";
import { EmptyState } from "@/components/shared/empty-state";
import { Pager } from "@/components/shared/pager";
import type { Page } from "@/lib/pagination";
import type { PortalThreadRow } from "@/lib/queries/portal-messages";

export const PORTAL_LIST_HREF = "/communication?view=portal";

export function PortalThreadList({
  rows,
  paging,
  tz = null,
}: {
  rows: PortalThreadRow[];
  paging: Pick<Page<unknown>, "page" | "pageCount" | "total" | "pageSize">;
  /** Viewer's IANA zone for formatRelative's older-than-30-days fallback. */
  tz?: string | null;
}) {
  const { total } = paging;
  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white">
      <div className="px-4 py-3 border-b border-line shrink-0">
        <div className="text-2xs font-medium text-ink-3">Client portal</div>
        <div className="text-xs font-semibold text-ink">
          {total} {total === 1 ? "conversation" : "conversations"}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={MessagesSquare}
            title="No client portal messages yet."
          />
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto">
          {rows.map((r) => (
            <li key={r.matterId}>
              <Link
                href={`/matters/${r.matterId}/communication?channel=portal`}
                className="block px-4 py-2.5 border-b border-line bg-white hover:bg-paper-2/60 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "text-xs truncate text-ink",
                      r.unread > 0 ? "font-semibold" : "font-medium"
                    )}
                  >
                    {r.matterName}
                  </span>
                  {r.awaitingReply && (
                    <span className="text-3xs font-medium px-1.5 py-0.5 rounded-full bg-warn/10 text-warn shrink-0">
                      Awaiting reply
                    </span>
                  )}
                  <span className="ml-auto text-2xs font-mono text-ink-4 shrink-0">
                    {formatRelative(r.lastMessageAt, tz)}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span
                    className={cn(
                      "text-2xs truncate",
                      r.unread > 0 ? "text-ink-2 font-medium" : "text-ink-3"
                    )}
                  >
                    {r.snippet}
                  </span>
                  {r.unread > 0 && (
                    <span className="ml-auto text-3xs font-mono font-medium px-1.5 rounded-full bg-paper-2 text-ink-2 shrink-0">
                      {r.unread}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Pager
        {...paging}
        href={PORTAL_LIST_HREF}
        prevLabel="Newer"
        nextLabel="Older"
        className="px-3 py-2 border-t border-line shrink-0"
      />
    </div>
  );
}
