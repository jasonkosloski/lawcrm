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
 *
 * Responsive: at lg+ both panes sit side by side. Below lg it drills
 * down like the main inbox - the list fills the width until a thread
 * is selected, then the reader takes over (its BackToListButton strips
 * `?thread=` to return to the list). A fixed-width list beside a
 * reader leaves the reader zero width on a phone.
 */

import { cn } from "@/lib/utils";
import { withPageParam, type Page } from "@/lib/pagination";
import { Pager } from "@/components/shared/pager";
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
  paging,
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
  /** Page metadata when the list is paged (`?page=N`); thread hrefs
   *  keep the page so opening a thread doesn't jump back to page 1. */
  paging?: Pick<Page<unknown>, "page" | "pageCount" | "total" | "pageSize">;
}) {
  const threadHref = (id: string): string =>
    withPageParam(`${basePath}?thread=${id}`, paging?.page ?? 1);

  return (
    <div className="flex gap-4 flex-1 min-h-0">
      {/* Left pane: thread list (hidden below lg while reading) */}
      <div
        className={cn(
          selectedThread ? "hidden lg:flex" : "flex w-full",
          "lg:w-88 lg:shrink-0 flex-col min-h-0 overflow-y-auto"
        )}
      >
        <EmbeddedThreadList
          threads={threads}
          emptyLabel={emptyLabel}
          emptyHint={emptyHint}
          showMatterChip={showMatterChip}
          threadHref={threadHref}
          selectedThreadId={selectedThread?.id ?? null}
          tz={tz}
        />
        {paging && (
          <Pager {...paging} href={basePath} className="mt-2 shrink-0" />
        )}
      </div>

      {/* Right pane: reader (below lg only once a thread is selected) */}
      {threads.length > 0 && (
        <div
          className={cn(
            selectedThread ? "flex" : "hidden lg:flex",
            "flex-1 min-w-0 flex-col min-h-0 rounded-lg border border-line overflow-hidden bg-paper-email"
          )}
        >
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
