import "server-only";

import { prisma } from "@/lib/prisma";
import { filterAccessibleMatterIds } from "@/lib/matter-access";

/**
 * True iff every matter with live portal access for this identity is one
 * the staff user may see. Guards identity-wide changes (disable, re-enable,
 * email change) so a walled user cannot affect matters they cannot see.
 */
export async function actorSeesAllPortalMatters(
  userId: string,
  identityId: string,
): Promise<boolean> {
  const rows = await prisma.portalMatterAccess.findMany({
    where: { identityId, revokedAt: null },
    select: { matterId: true },
  });
  if (rows.length === 0) return true;
  const ids = rows.map((r) => r.matterId);
  const seen = await filterAccessibleMatterIds(userId, ids);
  return ids.every((id) => seen.has(id));
}
