import "server-only";

import { prisma } from "@/lib/prisma";
import { assertMatterAccess } from "@/lib/matter-access";
import { currentUserHasPermission } from "@/lib/permission-check";

export type DocumentRequestRow = {
  id: string;
  title: string;
  instructions: string | null;
  /** Date-only (UTC midnight) calendar date. */
  dueDate: Date | null;
  /** open | submitted | complete | cancelled */
  status: string;
  returnNote: string | null;
  documents: { id: string; name: string }[];
};

/** True when at least one portal user can currently open the matter. */
export async function matterHasLivePortalAccess(matterId: string): Promise<boolean> {
  await assertMatterAccess(matterId);
  const n = await prisma.portalMatterAccess.count({
    where: { matterId, revokedAt: null },
  });
  return n > 0;
}

export type ClientRequestsData = {
  requests: DocumentRequestRow[];
  hasLiveAccess: boolean;
};

/** Staff list of a matter's document requests. Needs portal.view plus matter access. */
export async function getDocumentRequestsForMatter(matterId: string): Promise<ClientRequestsData> {
  await assertMatterAccess(matterId);
  if (!(await currentUserHasPermission("portal.view"))) {
    return { requests: [], hasLiveAccess: false };
  }
  const [rows, hasLiveAccess] = await Promise.all([
    prisma.documentRequest.findMany({
      where: { matterId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        instructions: true,
        dueDate: true,
        status: true,
        returnNote: true,
        documents: {
          orderBy: { createdAt: "asc" },
          select: { id: true, name: true },
        },
      },
    }),
    matterHasLivePortalAccess(matterId),
  ]);
  return { requests: rows, hasLiveAccess };
}
