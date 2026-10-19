import "server-only";

import { prisma } from "@/lib/prisma";
import { assertMatterAccess } from "@/lib/matter-access";
import { currentUserHasPermission } from "@/lib/permission-check";
import { getCurrentFirm } from "@/lib/firm";

export type PortalAccessRow = {
  accessId: string;
  identityId: string;
  contactName: string;
  email: string;
  invitedAt: Date;
  lastSignInAt: Date | null;
  revokedAt: Date | null;
};

/** Portal access list for a matter. Needs portal.view plus matter access. */
export async function getPortalAccessForMatter(
  matterId: string
): Promise<PortalAccessRow[]> {
  await assertMatterAccess(matterId);
  if (!(await currentUserHasPermission("portal.view"))) return [];

  const rows = await prisma.portalMatterAccess.findMany({
    where: { matterId },
    orderBy: { invitedAt: "desc" },
    select: {
      id: true,
      identityId: true,
      invitedAt: true,
      revokedAt: true,
      identity: {
        select: {
          email: true,
          contact: { select: { name: true } },
          sessions: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { createdAt: true },
          },
        },
      },
    },
  });
  return rows.map((r) => ({
    accessId: r.id,
    identityId: r.identityId,
    contactName: r.identity.contact.name,
    email: r.identity.email,
    invitedAt: r.invitedAt,
    lastSignInAt: r.identity.sessions[0]?.createdAt ?? null,
    revokedAt: r.revokedAt,
  }));
}

export type PortalCardData = {
  rows: PortalAccessRow[];
  /** Matter parties (client first) who are active, unmerged and have an email. */
  contacts: { id: string; name: string; email: string | null }[];
  portalEnabled: boolean;
};

/** Everything the matter Portal card needs. Call only for portal.view holders. */
export async function getPortalCardData(
  matterId: string
): Promise<PortalCardData> {
  // Same gate order as getPortalAccessForMatter: wall first (throws
  // notFound), then the permission, before any matter-scoped query.
  await assertMatterAccess(matterId);
  if (!(await currentUserHasPermission("portal.view"))) {
    return { rows: [], contacts: [], portalEnabled: false };
  }
  const [rows, parties, firm] = await Promise.all([
    getPortalAccessForMatter(matterId),
    prisma.matterContact.findMany({
      where: {
        matterId,
        contact: { isActive: true, mergedIntoId: null },
      },
      orderBy: [{ category: "asc" }, { createdAt: "asc" }],
      select: {
        category: true,
        contact: { select: { id: true, name: true, email: true } },
      },
    }),
    getCurrentFirm().then((f) =>
      prisma.firm.findUnique({
        where: { id: f.id },
        select: { portalEnabled: true },
      })
    ),
  ]);
  const seen = new Set<string>();
  const contacts = parties
    // Clients first, then everyone else in creation order.
    .sort((a, b) => Number(b.category === "client") - Number(a.category === "client"))
    .map((p) => p.contact)
    .filter((c) => !seen.has(c.id) && !!seen.add(c.id));
  return { rows, contacts, portalEnabled: firm?.portalEnabled ?? false };
}
