/**
 * Reply section — async server component at the bottom of the thread
 * reader. Self-fetching so BOTH hosts (the /communication reader and
 * the embedded matter/intake reader) get reply without threading new
 * props through their pages:
 *
 *   - no `communication.send_email` → renders nothing
 *   - thread's account not connected (grant revoked/expired) →
 *     "reconnect" note linking /settings/integrations
 *   - otherwise → the ReplyComposer with recipients derived from the
 *     thread's last inbound message (reply + reply-all variants)
 *
 * The account lookup re-applies the `account: { userId }` scoping —
 * getThreadById already guarantees it, but this component shouldn't
 * trust its caller for an ownership property it depends on.
 */

import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getEmailSignature } from "@/lib/email-signature";
import { getCurrentUserId } from "@/lib/current-user";
import { currentUserHasPermission } from "@/lib/permission-check";
import { deriveReplyRecipients } from "@/lib/google/mime";
import type {
  FilingLeadOption,
  FilingMatterOption,
  ThreadDetail,
} from "@/lib/queries/communication";
import { isSendableStatus } from "@/lib/email-send-status";
import { activeStorageDriver } from "@/lib/file-storage";
import { ReplyComposer } from "./reply-composer";

export async function ReplySection({
  thread,
  matters,
  leads,
  canFile,
}: {
  thread: ThreadDetail;
  /** Record options for the picker shown when the thread is unfiled. */
  matters: FilingMatterOption[];
  leads: FilingLeadOption[];
  /** `communication.file_email` - whether the viewer may file it. */
  canFile: boolean;
}) {
  const canSend = await currentUserHasPermission("communication.send_email");
  if (!canSend) return null;

  const userId = await getCurrentUserId();
  const row = await prisma.emailThread.findFirst({
    where: { id: thread.id, account: { userId } },
    select: {
      account: { select: { emailAddress: true, syncStatus: true } },
    },
  });
  if (!row) return null;

  if (!isSendableStatus(row.account.syncStatus)) {
    return (
      <div className="bg-white rounded-lg border border-dashed border-line px-3 sm:px-4 py-3 flex items-center gap-2 text-xs text-ink-3">
        <TriangleAlert size={13} className="text-warn shrink-0" />
        <span>
          <span className="font-mono">{row.account.emailAddress}</span> isn&apos;t
          connected — reconnect it to reply.
        </span>
        <Link
          href="/settings/integrations"
          className="ml-auto shrink-0 text-brand-700 hover:underline font-medium"
        >
          Reconnect Gmail
        </Link>
      </div>
    );
  }

  // Same source shape + helper the reply action derives from — what
  // the composer previews is what an unedited send will use.
  const source = thread.messages.map((m) => ({
    fromName: m.fromName,
    fromEmail: m.fromEmail,
    toRecipients: m.toRecipients,
    ccRecipients: m.ccRecipients,
  }));
  const reply = deriveReplyRecipients(source, row.account.emailAddress, false);
  const replyAll = deriveReplyRecipients(source, row.account.emailAddress, true);
  const [canUpload, signature] = await Promise.all([
    currentUserHasPermission("documents.upload"),
    getEmailSignature(userId),
  ]);
  const recordScope = thread.matter
    ? ({ kind: "matter", matterId: thread.matter.id } as const)
    : thread.lead
      ? ({ kind: "lead", leadId: thread.lead.id } as const)
      : null;

  return (
    // key by thread: ?thread= switches are search-param navigations
    // that keep client state, so without it a draft + edited
    // recipients from thread A would survive onto thread B.
    <ReplyComposer
      key={thread.id}
      threadId={thread.id}
      accountEmail={row.account.emailAddress}
      reply={reply}
      replyAll={replyAll}
      needsRecord={recordScope === null}
      recordScope={recordScope}
      canUpload={canUpload}
      storageDriver={activeStorageDriver()}
      canFile={canFile}
      matters={matters}
      leads={leads}
      signature={signature}
    />
  );
}
