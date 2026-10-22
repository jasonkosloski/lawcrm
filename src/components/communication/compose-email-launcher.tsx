/**
 * Compose launcher — async server component that resolves everything
 * the compose button needs, so host surfaces (the inbox thread-list
 * header) can mount it without threading new props through pages:
 *
 *   - `communication.send_email` read-side flag → renders nothing
 *     without it
 *   - the CURRENT USER's connected Gmail accounts (multi-user: every
 *     send goes from one of the caller's own mailboxes; nothing
 *     hardcoded) → an empty list renders the "Connect Gmail" link
 *     inside ComposeEmailButton
 *
 * The account lookup is inline prisma rather than a queries/email*
 * module — that namespace belongs to the sync workstream; fold this
 * into a shared listSendableAccounts() query when it exists.
 */

import { prisma } from "@/lib/prisma";
import { getEmailSignature } from "@/lib/email-signature";
import { getCurrentUserId } from "@/lib/current-user";
import { currentUserHasPermission } from "@/lib/permission-check";
import { SENDABLE_EMAIL_STATUSES } from "@/lib/email-send-status";
import { activeStorageDriver } from "@/lib/file-storage";
import {
  getFilingLeadOptions,
  getFilingMatterOptions,
} from "@/lib/queries/communication";
import type { RecordScope } from "@/lib/record-scope";
import { ComposeEmailButton } from "./compose-email";

/** `initialScope` prefills the required record (matter / lead tabs). */
export async function ComposeEmailLauncher({
  initialScope,
}: {
  initialScope?: RecordScope;
} = {}) {
  const canSend = await currentUserHasPermission("communication.send_email");
  if (!canSend) return null;

  const userId = await getCurrentUserId();
  // Record options load only past the send gate.
  const [accounts, matters, leads, canUpload, signature] = await Promise.all([
    prisma.emailAccount.findMany({
      where: {
        userId,
        provider: "gmail", // send path is Gmail-only today
        syncStatus: { in: [...SENDABLE_EMAIL_STATUSES] },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, emailAddress: true },
    }),
    getFilingMatterOptions(),
    getFilingLeadOptions(),
    currentUserHasPermission("documents.upload"),
    getEmailSignature(userId),
  ]);

  return (
    <ComposeEmailButton
      accounts={accounts}
      matters={matters}
      leads={leads}
      initialScope={initialScope}
      canUpload={canUpload}
      storageDriver={activeStorageDriver()}
      signature={signature}
    />
  );
}
