/**
 * Lead Detail — Communication tab
 *
 * Email threads that reference this lead's email address (as
 * sender, recipient, or cc). Leads don't have a direct `threadId`
 * relation today — matching by email is the pragmatic v1 approach.
 * When the intake ↔ communication linkage tightens (e.g., a lead
 * gets its own threadIds from auto-matching), we swap out the query
 * without changing this page.
 */

import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { EmbeddedThreadList } from "@/components/communication/embedded-thread-list";
import { listThreadsForEmail } from "@/lib/queries/communication";
import { getLeadById } from "@/lib/queries/leads";

export default async function LeadCommunicationPage({
  params,
}: PageProps<"/intake/[id]/communication">) {
  const { id } = await params;
  const lead = await getLeadById(id);
  if (!lead) notFound();

  const threads = lead.email
    ? await listThreadsForEmail(lead.email)
    : [];

  return (
    <div className="p-5">
      <div className="max-w-4xl flex flex-col gap-4">
        {!lead.email && (
          <Card>
            <div className="p-5 text-xs text-ink-3">
              This lead has no email address on file, so there's nothing
              to match threads against. When a phone number is captured,
              this tab will grow to include SMS too.
            </div>
          </Card>
        )}

        {lead.email && (
          <>
            <div className="text-2xs font-mono text-ink-4">
              Matching threads where{" "}
              <span className="text-ink-3">{lead.email}</span> is the
              sender, recipient, or cc.
            </div>
            <EmbeddedThreadList
              threads={threads}
              emptyLabel="No communication yet"
              emptyHint={`Emails to or from ${lead.email} will surface here. Once we wire SMS, text threads will land here too.`}
            />
          </>
        )}
      </div>
    </div>
  );
}
