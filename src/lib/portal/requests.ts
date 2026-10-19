import "server-only";

import { prisma } from "@/lib/prisma";
import { portalMatterWhere } from "@/lib/portal-access";
import { dateOnlyKey, daysUntilDateOnly } from "@/lib/format-date";

/** Same default zone as staff profiles (current-user-tz.ts, which pulls in auth). */
const PORTAL_DUE_TIME_ZONE = "America/Denver";

export type PortalRequest = {
  id: string;
  title: string;
  instructions: string | null;
  /** Calendar date `YYYY-MM-DD` (date-only, ADR-012). */
  dueDate: string | null;
  returnNote: string | null;
  overdue: boolean;
};

export type PortalRequestGroups = {
  open: PortalRequest[];
  submitted: PortalRequest[];
  done: PortalRequest[];
};

/**
 * Document requests on a matter, grouped for the client. Cancelled requests
 * never show. "Open" includes ones sent back (status stays `open`). Empty
 * unless the identity holds live access to the matter.
 */
export async function listPortalRequests(
  identityId: string,
  matterId: string,
): Promise<PortalRequestGroups> {
  const groups: PortalRequestGroups = { open: [], submitted: [], done: [] };
  const matter = await prisma.matter.findFirst({
    where: { id: matterId, ...portalMatterWhere(identityId) },
    select: { id: true },
  });
  if (!matter) return groups;

  const rows = await prisma.documentRequest.findMany({
    where: { matterId, status: { in: ["open", "submitted", "complete"] } },
    select: {
      id: true,
      title: true,
      instructions: true,
      dueDate: true,
      returnNote: true,
      status: true,
    },
    orderBy: [
      { dueDate: { sort: "asc", nulls: "last" } },
      { createdAt: "asc" },
    ],
  });
  // Clients have no profile zone; "today" is the firm's default zone.
  const tz = PORTAL_DUE_TIME_ZONE;
  for (const r of rows) {
    const req: PortalRequest = {
      id: r.id,
      title: r.title,
      instructions: r.instructions,
      dueDate: r.dueDate ? dateOnlyKey(r.dueDate) : null,
      returnNote: r.returnNote,
      overdue:
        r.status === "open" &&
        !!r.dueDate &&
        daysUntilDateOnly(r.dueDate, tz) < 0,
    };
    if (r.status === "open") groups.open.push(req);
    else if (r.status === "submitted") groups.submitted.push(req);
    else groups.done.push(req);
  }
  return groups;
}

/** Open (incl. sent back) request counts per matter, live access only. */
export async function countOpenRequestsByMatter(
  identityId: string,
): Promise<Map<string, number>> {
  const rows = await prisma.documentRequest.groupBy({
    by: ["matterId"],
    where: { status: "open", matter: portalMatterWhere(identityId) },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.matterId, r._count._all]));
}
