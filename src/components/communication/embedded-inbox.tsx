/**
 * Embedded Inbox
 *
 * Two-pane mini inbox for matter/intake Communication tabs:
 *   - Left: compact thread list scoped to the current context
 *   - Right: thread reader that updates when the user clicks a thread
 *
 * Clicking a thread sets `?thread=<id>` on the current URL (via the
 * `basePath` prop) so navigation never leaves the matter/intake. The
 * container is capped in height and each pane scrolls independently.
 */

import { EmbeddedThreadList } from "./embedded-thread-list";
import { ThreadReader } from "./thread-reader";
import type {
  FilingMatterOption,
  ThreadDetail,
  ThreadListRow,
} from "@/lib/queries/communication";

export function EmbeddedInbox({
  threads,
  selectedThread,
  filingOptions,
  basePath,
  emptyLabel,
  emptyHint,
  showMatterChip = true,
  tz = null,
}: {
  threads: ThreadListRow[];
  selectedThread: ThreadDetail | null;
  /** Open-matter list for the file-to-matter picker on the embedded
   *  thread reader. Caller passes from getFilingMatterOptions(). */
  filingOptions: FilingMatterOption[];
  /** Page URL used to build thread selection hrefs
   *  (e.g. "/matters/[id]/communication"). */
  basePath: string;
  emptyLabel: string;
  emptyHint?: string;
  showMatterChip?: boolean;
  /** Viewer's IANA zone — message timestamps are real instants
   *  (ADR-012); forwarded to the list + reader panes. */
  tz?: string | null;
}) {
  const threadHref = (id: string): string => `${basePath}?thread=${id}`;

  return (
    <div className="flex gap-4 flex-1 min-h-0">
      {/* Left pane: thread list */}
      <div className="w-88 shrink-0 flex flex-col min-h-0 overflow-y-auto">
        <EmbeddedThreadList
          threads={threads}
          emptyLabel={emptyLabel}
          emptyHint={emptyHint}
          showMatterChip={showMatterChip}
          threadHref={threadHref}
          selectedThreadId={selectedThread?.id ?? null}
          tz={tz}
        />
      </div>

      {/* Right pane: reader */}
      {threads.length > 0 && (
        <div className="flex-1 min-w-0 flex flex-col min-h-0 rounded-lg border border-line overflow-hidden bg-paper-email">
          <ThreadReader
            thread={selectedThread}
            filingOptions={filingOptions}
            tz={tz}
          />
        </div>
      )}
    </div>
  );
}
