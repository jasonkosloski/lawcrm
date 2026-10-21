import "server-only";

import { prisma } from "@/lib/prisma";
import { assertMatterAccess } from "@/lib/matter-access";
import { currentUserHasPermission } from "@/lib/permission-check";
import { matterHasLivePortalAccess } from "@/lib/queries/document-requests";

export type ClientStatusUpdateRow = {
  id: string;
  stageLabel: string;
  body: string;
  postedAt: Date;
  editedAt: Date | null;
  emailedAt: Date | null;
  postedByName: string;
};

export type ClientStatusCardData = {
  /** Newest first. */
  updates: ClientStatusUpdateRow[];
  hasLiveAccess: boolean;
};

/**
 * Staff view of a matter's client status updates. Same gate order as
 * getPortalCardData: matter wall first (throws notFound), then
 * portal.view (null without it), before any matter-scoped query.
 */
export async function getClientStatusCardData(
  matterId: string
): Promise<ClientStatusCardData | null> {
  await assertMatterAccess(matterId);
  if (!(await currentUserHasPermission("portal.view"))) return null;

  const [rows, hasLiveAccess] = await Promise.all([
    prisma.portalStatusUpdate.findMany({
      where: { matterId },
      orderBy: { postedAt: "desc" },
      select: {
        id: true,
        stageLabel: true,
        body: true,
        postedAt: true,
        editedAt: true,
        emailedAt: true,
        postedBy: { select: { name: true } },
      },
    }),
    matterHasLivePortalAccess(matterId),
  ]);
  return {
    updates: rows.map(({ postedBy, ...u }) => ({
      ...u,
      postedByName: postedBy.name,
    })),
    hasLiveAccess,
  };
}
