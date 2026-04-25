/**
 * Matter Detail — Communication tab
 *
 * Mini inbox scoped to this matter: thread list on the left, reader
 * on the right. Clicking a thread updates `?thread=<id>` on the
 * current URL — reader swaps in place, no navigation away.
 *
 * The selected thread is validated against the matter's thread list
 * before being fetched: a user can't paste in a random `?thread=<id>`
 * to read threads belonging to other matters.
 */

import { EmbeddedInbox } from "@/components/communication/embedded-inbox";
import {
  getFilingMatterOptions,
  getThreadById,
  listThreadsForMatter,
} from "@/lib/queries/communication";

export default async function MatterCommunicationPage({
  params,
  searchParams,
}: PageProps<"/matters/[id]/communication">) {
  const { id } = await params;
  const sp = await searchParams;
  const rawThread = Array.isArray(sp.thread) ? sp.thread[0] : sp.thread;
  const requestedThreadId =
    typeof rawThread === "string" ? rawThread : null;

  const [threads, filingOptions] = await Promise.all([
    listThreadsForMatter(id),
    getFilingMatterOptions(),
  ]);

  // Only allow reading threads that are actually on this matter.
  const threadId =
    requestedThreadId && threads.some((t) => t.id === requestedThreadId)
      ? requestedThreadId
      : null;

  const selectedThread = threadId ? await getThreadById(threadId) : null;

  return (
    <div className="p-5 flex flex-col flex-1 min-h-0">
      <EmbeddedInbox
        threads={threads}
        selectedThread={selectedThread}
        filingOptions={filingOptions}
        basePath={`/matters/${id}/communication`}
        emptyLabel="No communication filed to this matter"
        emptyHint="Emails and text messages filed to this matter will appear here. File a thread from the main inbox or let auto-filing catch it."
        showMatterChip={false}
      />
    </div>
  );
}
