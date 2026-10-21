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
      orderBy: [{ postedAt: "desc" }, { id: "desc" }],
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

export type EventShare = { clientTitle: string; clientNote: string | null };

/**
 * The client-facing share for an event, or null. A share counts only
 * while its matter snapshot equals the event's current matter (a
 * re-filed event stops being shared). The caller has already asserted
 * access to the event; only the client-facing fields are returned.
 */
export async function getEventShare(eventId: string): Promise<EventShare | null> {
  const share = await prisma.portalSharedEvent.findUnique({
    where: { eventId },
    select: {
      clientTitle: true,
      clientNote: true,
      matterId: true,
      event: { select: { matterId: true } },
    },
  });
  if (!share || share.matterId !== share.event.matterId) return null;
  return { clientTitle: share.clientTitle, clientNote: share.clientNote };
}

export type EventPortalShareProp = {
  canShare: boolean;
  share: EventShare | null;
};

/**
 * Modal prop for the share control: undefined for lead events (no
 * matter) and for viewers without portal.view.
 */
export async function getEventPortalShareProp(
  eventId: string,
  matterId: string | null | undefined
): Promise<EventPortalShareProp | undefined> {
  if (!matterId) return undefined;
  if (!(await currentUserHasPermission("portal.view"))) return undefined;
  const [canShare, share] = await Promise.all([
    currentUserHasPermission("portal.share_events"),
    getEventShare(eventId),
  ]);
  return { canShare, share };
}
