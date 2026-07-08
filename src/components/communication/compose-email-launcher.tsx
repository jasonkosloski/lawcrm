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
import { getCurrentUserId } from "@/lib/current-user";
import { currentUserHasPermission } from "@/lib/permission-check";
import { ComposeEmailButton } from "./compose-email";

/** Send requires a live grant: "connected" (idle) or "syncing".
 *  "error"/"disconnected" mean reconnect first. */
const SENDABLE_STATUSES = ["connected", "syncing"];

export async function ComposeEmailLauncher() {
  const canSend = await currentUserHasPermission("communication.send_email");
  if (!canSend) return null;

  const userId = await getCurrentUserId();
  const accounts = await prisma.emailAccount.findMany({
    where: {
      userId,
      provider: "gmail", // send path is Gmail-only today
      syncStatus: { in: SENDABLE_STATUSES },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, emailAddress: true },
  });

  return <ComposeEmailButton accounts={accounts} />;
}
