import "server-only";

import { prisma } from "@/lib/prisma";
import { livePortalMatterWhere } from "@/lib/portal/status";

export type PortalMessageView = {
  id: string;
  body: string;
  createdAt: Date;
  fromClient: boolean;
  authorLabel: string;
};

/**
 * The matter's conversation as one client sees it, oldest first. Empty
 * unless the identity holds live access (portal on, identity enabled).
 * Archived matters stay readable.
 */
export async function getPortalMessages(
  identityId: string,
  matterId: string,
): Promise<PortalMessageView[]> {
  const where = await livePortalMatterWhere(identityId);
  if (!where) return [];
  const matter = await prisma.matter.findFirst({
    where: { id: matterId, ...where },
    select: { id: true },
  });
  if (!matter) return [];

  const rows = await prisma.portalMessage.findMany({
    where: { thread: { matterId } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      body: true,
      createdAt: true,
      authorKind: true,
      authorIdentityId: true,
      authorIdentity: { select: { contact: { select: { name: true } } } },
      authorUser: { select: { name: true } },
    },
  });
  return rows.map((r) => {
    const fromClient = r.authorKind === "client";
    const authorLabel = fromClient
      ? r.authorIdentityId === identityId
        ? "You"
        : (r.authorIdentity?.contact.name ?? "Another client")
      : `${r.authorUser?.name ?? "Your legal team"} (your legal team)`;
    return { id: r.id, body: r.body, createdAt: r.createdAt, fromClient, authorLabel };
  });
}

/**
 * Of `matterIds`, those where the firm has written something this identity
 * has not read. Only matters the identity can live-access are considered.
 */
export async function unreadPortalMessageMatters(
  identityId: string,
  matterIds: string[],
): Promise<Set<string>> {
  if (matterIds.length === 0) return new Set();
  const where = await livePortalMatterWhere(identityId);
  if (!where) return new Set();
  const threads = await prisma.portalThread.findMany({
    where: { matterId: { in: matterIds }, matter: where },
    select: {
      matterId: true,
      readStates: { where: { identityId }, select: { lastReadAt: true } },
    },
  });
  const unread = new Set<string>();
  for (const t of threads) {
    const lastReadAt = t.readStates[0]?.lastReadAt;
    const newer = await prisma.portalMessage.findFirst({
      where: {
        thread: { matterId: t.matterId },
        authorKind: "staff",
        ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
      },
      select: { id: true },
    });
    if (newer) unread.add(t.matterId);
  }
  return unread;
}
