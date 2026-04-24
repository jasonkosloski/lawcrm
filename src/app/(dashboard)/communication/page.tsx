/**
 * Communication Page
 *
 * Unified inbox — email-first today, will absorb SMS and voicemail
 * later under the same route. Three-pane layout: mailbox rail (left)
 * · thread list (middle) · reader (right).
 *
 * State lives in the URL:
 *   ?filter=all|unread|starred|unfiled
 *   ?thread=<id>
 *
 * Read-only for v1. Compose / reply / file-to-matter / star-toggle
 * all plug in later on top of the existing URL contract.
 */

import { TopBar } from "@/components/layout/topbar";
import { MailboxRail } from "@/components/communication/mailbox-rail";
import { ThreadList } from "@/components/communication/thread-list";
import { ThreadReader } from "@/components/communication/thread-reader";
import {
  getCommunicationCounts,
  getThreadById,
  listThreads,
  type CommunicationFilter,
} from "@/lib/queries/communication";

function parseFilter(
  raw: string | string[] | undefined
): CommunicationFilter {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "unread" || v === "starred" || v === "unfiled" || v === "all")
    return v;
  return "all";
}

export default async function CommunicationPage({
  searchParams,
}: PageProps<"/communication">) {
  const sp = await searchParams;
  const filter = parseFilter(sp.filter);
  const rawThread = Array.isArray(sp.thread) ? sp.thread[0] : sp.thread;
  const threadId = typeof rawThread === "string" ? rawThread : null;

  const [threads, counts, selectedThread] = await Promise.all([
    listThreads(filter),
    getCommunicationCounts(),
    threadId ? getThreadById(threadId) : Promise.resolve(null),
  ]);

  return (
    <>
      <TopBar
        title="Communication"
        crumbs={`${counts.all} total · ${counts.unread} unread`}
      />

      <div className="flex-1 flex min-h-0">
        <MailboxRail
          counts={counts}
          activeFilter={filter}
          selectedThreadId={threadId}
        />
        <ThreadList
          threads={threads}
          filter={filter}
          selectedThreadId={threadId}
        />
        <ThreadReader thread={selectedThread} />
      </div>
    </>
  );
}
