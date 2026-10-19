import "server-only";

import { prisma } from "@/lib/prisma";
import { assertMatterAccess } from "@/lib/matter-access";
import { currentUserHasPermission } from "@/lib/permission-check";

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
