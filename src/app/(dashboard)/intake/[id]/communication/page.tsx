/**
 * Lead Detail — Communication tab
 *
 * Mini inbox scoped to this lead: thread list on the left, reader on
 * the right. Matching is by the lead's email address (see
 * `listThreadsForEmail`) since Leads don't have a direct EmailThread
 * relation today. Clicking a thread updates `?thread=<id>` in place —
 * navigation stays on the lead.
 */

import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { EmbeddedInbox } from "@/components/communication/embedded-inbox";
import {
  getThreadById,
  listThreadsForEmail,
} from "@/lib/queries/communication";
import { getLeadById } from "@/lib/queries/leads";

export default async function LeadCommunicationPage({
  params,
  searchParams,
}: PageProps<"/intake/[id]/communication">) {
  const { id } = await params;
  const sp = await searchParams;
  const rawThread = Array.isArray(sp.thread) ? sp.thread[0] : sp.thread;
  const requestedThreadId =
    typeof rawThread === "string" ? rawThread : null;

  const lead = await getLeadById(id);
  if (!lead) notFound();

  const threads = lead.email ? await listThreadsForEmail(lead.email) : [];

  // Only allow reading threads that are actually in the lead's set.
  const threadId =
    requestedThreadId && threads.some((t) => t.id === requestedThreadId)
      ? requestedThreadId
      : null;

  const selectedThread = threadId ? await getThreadById(threadId) : null;

  if (!lead.email) {
    return (
      <div className="p-5">
        <div className="max-w-4xl">
          <Card>
            <div className="p-5 text-xs text-ink-3">
              This lead has no email address on file, so there&apos;s
              nothing to match threads against. When a phone number is
              captured, this tab will grow to include SMS too.
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 flex flex-col flex-1 min-h-0 gap-3">
      <div className="text-2xs font-mono text-ink-4 shrink-0">
        Matching threads where{" "}
        <span className="text-ink-3">{lead.email}</span> is the sender,
        recipient, or cc.
      </div>
      <EmbeddedInbox
        threads={threads}
        selectedThread={selectedThread}
        basePath={`/intake/${id}/communication`}
        emptyLabel="No communication yet"
        emptyHint={`Emails to or from ${lead.email} will surface here. Once we wire SMS, text threads will land here too.`}
      />
    </div>
  );
}
