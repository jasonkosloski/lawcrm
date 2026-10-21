import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { portalMatterWhere } from "@/lib/portal-access";
import { dateKeyInTz, dateOnlyKey, todayKey } from "@/lib/format-date";

/** Same default zone as the rest of the portal (clients have no profile zone). */
const PORTAL_TIME_ZONE = "America/Denver";

export type PortalStatusUpdateView = {
  id: string;
  stageLabel: string;
  body: string;
  postedAt: Date;
  edited: boolean;
};

export type PortalSharedEventView = {
  id: string;
  title: string;
  note: string | null;
  startTime: Date;
  endTime: Date;
  isAllDay: boolean;
  location: string | null;
};

export type PortalMatterStatus = {
  updates: PortalStatusUpdateView[];
  upcoming: PortalSharedEventView[];
  past: PortalSharedEventView[];
};

/**
 * Live-access gate. `portalMatterWhere` only covers revoked access; the
 * firm-level portal switch and a disabled identity are checked here too, so
 * a staged status update never leaks once either is turned off.
 */
async function liveMatterWhere(
  identityId: string,
): Promise<Prisma.MatterWhereInput | null> {
  const firm = await prisma.firm.findFirst({ select: { portalEnabled: true } });
  if (!firm?.portalEnabled) return null;
  const identity = await prisma.portalIdentity.findUnique({
    where: { id: identityId },
    select: { disabledAt: true },
  });
  if (!identity || identity.disabledAt) return null;
  return portalMatterWhere(identityId);
}

/**
 * Status updates and shared calendar events for one matter, as the client
 * sees them. Empty unless the identity holds live access (and the portal is
 * on and the identity enabled). Archived matters stay readable.
 */
export async function getPortalMatterStatus(
  identityId: string,
  matterId: string,
): Promise<PortalMatterStatus> {
  const empty: PortalMatterStatus = { updates: [], upcoming: [], past: [] };
  const where = await liveMatterWhere(identityId);
  if (!where) return empty;
  const matter = await prisma.matter.findFirst({
    where: { id: matterId, ...where },
    select: { id: true },
  });
  if (!matter) return empty;

  const [updateRows, shareRows] = await Promise.all([
    prisma.portalStatusUpdate.findMany({
      where: { matterId },
      select: {
        id: true,
        stageLabel: true,
        body: true,
        postedAt: true,
        editedAt: true,
      },
      orderBy: { postedAt: "desc" },
    }),
    // `event.matterId` (not the snapshot) so an event re-filed to another
    // matter disappears from both.
    prisma.portalSharedEvent.findMany({
      where: { matterId, event: { matterId } },
      select: {
        id: true,
        clientTitle: true,
        clientNote: true,
        event: {
          select: {
            startTime: true,
            endTime: true,
            isAllDay: true,
            location: true,
          },
        },
      },
    }),
  ]);

  const today = todayKey(PORTAL_TIME_ZONE);
  const upcoming: PortalSharedEventView[] = [];
  const past: PortalSharedEventView[] = [];
  for (const s of shareRows) {
    const view: PortalSharedEventView = {
      id: s.id,
      title: s.clientTitle,
      note: s.clientNote,
      startTime: s.event.startTime,
      endTime: s.event.endTime,
      isAllDay: s.event.isAllDay,
      location: s.event.location,
    };
    // All-day values are UTC-midnight calendar dates (ADR-012); timed ones
    // are instants read in the portal zone.
    const endKey = view.isAllDay
      ? dateOnlyKey(view.endTime)
      : dateKeyInTz(view.endTime, PORTAL_TIME_ZONE);
    (endKey >= today ? upcoming : past).push(view);
  }
  upcoming.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  past.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());

  return {
    updates: updateRows.map((u) => ({
      id: u.id,
      stageLabel: u.stageLabel,
      body: u.body,
      postedAt: u.postedAt,
      edited: u.editedAt !== null,
    })),
    upcoming,
    past,
  };
}

/** Latest stage label per matter, only for matters with live access. */
export async function latestStageLabels(
  identityId: string,
  matterIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (matterIds.length === 0) return out;
  const where = await liveMatterWhere(identityId);
  if (!where) return out;
  const rows = await prisma.portalStatusUpdate.findMany({
    where: { matterId: { in: matterIds }, matter: where },
    select: { matterId: true, stageLabel: true },
    orderBy: { postedAt: "desc" },
    distinct: ["matterId"],
  });
  for (const r of rows) out.set(r.matterId, r.stageLabel);
  return out;
}
