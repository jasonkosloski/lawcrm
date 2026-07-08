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
import { getCurrentUserId } from "@/lib/current-user";
import { currentUserHasPermission } from "@/lib/permission-check";
import { deriveReplyRecipients } from "@/lib/google/mime";
import type { ThreadDetail } from "@/lib/queries/communication";
import { ReplyComposer } from "./reply-composer";

const SENDABLE_STATUSES = new Set(["connected", "syncing"]);

export async function ReplySection({ thread }: { thread: ThreadDetail }) {
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

  if (!SENDABLE_STATUSES.has(row.account.syncStatus)) {
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

  return (
    <ReplyComposer
      threadId={thread.id}
      accountEmail={row.account.emailAddress}
      reply={reply}
      replyAll={replyAll}
    />
  );
}
