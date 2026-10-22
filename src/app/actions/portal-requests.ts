"use server";

import { getPortalIdentity, portalMatterWhere } from "@/lib/portal-access";
import { prisma } from "@/lib/prisma";

/**
 * Current status of a request the caller can reach, so the uploader can say
 * "closed by the firm" after a blob upload (the webhook result never reaches
 * the browser). Null when signed out or without live access. Never redirects.
 */
export async function getPortalRequestStatus(
  requestId: string,
): Promise<{ status: string } | null> {
  const identity = await getPortalIdentity();
  if (!identity) return null;
  const row = await prisma.documentRequest.findFirst({
    where: { id: requestId, matter: portalMatterWhere(identity.identityId) },
    select: { status: true },
  });
  return row ? { status: row.status } : null;
}
