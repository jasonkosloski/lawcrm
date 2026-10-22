/**
 * Matter Detail — Timeline (activity) tab readers.
 */

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { activityMoneyFilters, type ActivityMoneyAccess } from "@/lib/activity-money-filters";

// ── Matter activity / timeline ─────────────────────────────────────────

export type ActivityRow = {
  id: string;
  type: string;
  title: string;
  detail: string | null;
  iconName: string;
  source: string;
  timestamp: Date;
  /** Author of the action when known. Some actions (seeds, system
   *  events) have null userId — those render with a generic
   *  "system" badge. */
  authorName: string | null;
  authorInitials: string | null;
};

/// Cap how many rows the timeline page pulls in one shot. Matters
/// that age past this number need to switch to the eventual
/// load-more / paginated viewer.
export const MATTER_ACTIVITY_LIMIT = 200;

/** What the viewer may see of money-bearing activity rows. All
 *  default to false (hidden) so a caller that forgets to resolve the
 *  permissions fails closed. */
// Shared with the dashboard feed and Settings → Activity (F085 / F145).
export { activityMoneyFilters, type ActivityMoneyAccess } from "@/lib/activity-money-filters";

/** Pull the matter's activity log rows (newest first), joined to
 *  the author for display. Optional `types` filter narrows to a
 *  specific category — used by the URL-driven filter pills on the
 *  Timeline tab. Settlement / expense rows are omitted unless the
 *  caller passes the matching `canView*` flag. */
export async function getMatterActivity(
  matterId: string,
  options: {
    types?: readonly string[];
    limit?: number;
  } & ActivityMoneyAccess = {},
): Promise<ActivityRow[]> {
  const where: Prisma.ActivityLogWhereInput = {
    matterId,
    AND: activityMoneyFilters(options),
  };
  if (options.types && options.types.length > 0) {
    where.type = { in: [...options.types] };
  }
  const rows = await prisma.activityLog.findMany({
    where,
    orderBy: { timestamp: "desc" },
    take: options.limit ?? MATTER_ACTIVITY_LIMIT,
    include: {
      user: { select: { name: true, initials: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    detail: r.detail,
    iconName: r.icon ?? "zap",
    source: r.source ?? "System",
    timestamp: r.timestamp,
    authorName: r.user?.name ?? null,
    authorInitials: r.user?.initials ?? null,
  }));
}

/** Counts every type bucket on the matter, keyed by `type`. Drives
 *  the filter pills' badge counts so the user can see "8 emails / 3
 *  filings / 12 notes" before clicking. */
export async function getMatterActivityTypeCounts(
  matterId: string,
  access: ActivityMoneyAccess = {},
): Promise<Record<string, number>> {
  const grouped = await prisma.activityLog.groupBy({
    by: ["type"],
    where: { matterId, AND: activityMoneyFilters(access) },
    _count: { type: true },
  });
  const out: Record<string, number> = {};
  for (const g of grouped) out[g.type] = g._count.type;
  return out;
}
