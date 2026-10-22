/** Read-side queries for venues (courts / jurisdictions a matter is filed in). */

import { prisma } from "@/lib/prisma";

export type VenueOption = {
  id: string;
  name: string;
  city: string | null;
  county: string | null;
  state: string;
  isActive: boolean;
};

/** Venues ordered by name, with the number of matters using each. */
export async function listVenues(opts: { activeOnly: boolean }): Promise<
  (VenueOption & {
    matterCount: number;
    courtFormatId?: string | null;
    captionName?: string | null;
  })[]
> {
  const rows = await prisma.venue.findMany({
    where: opts.activeOnly ? { isActive: true } : undefined,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      city: true,
      county: true,
      state: true,
      isActive: true,
      courtFormatId: true,
      captionName: true,
      _count: { select: { matters: true } },
    },
  });
  return rows.map(({ _count, ...v }) => ({ ...v, matterCount: _count.matters }));
}
