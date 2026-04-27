/**
 * Firm-wide activity log query.
 *
 * Cross-matter view of every ActivityLog row, with optional
 * filters (user / type / date range). Drives the
 * /settings/activity audit page.
 *
 * Capped at 200 rows per request — same as the matter-scoped
 * Timeline. Older entries land in a future archive view.
 */

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export type FirmActivityRow = {
  id: string;
  type: string;
  title: string;
  detail: string | null;
  iconName: string;
  source: string;
  timestamp: Date;
  /** When the row is matter-scoped, the matter name + id for a
   *  deep-link. Firm-scope rows (permission grants, etc.) carry
   *  null. */
  matterId: string | null;
  matterName: string | null;
  authorId: string | null;
  authorName: string | null;
  authorInitials: string | null;
};

const FIRM_ACTIVITY_LIMIT = 200;

export type FirmActivityFilter = {
  types?: readonly string[];
  userId?: string;
  /** ISO date "YYYY-MM-DD" — inclusive lower bound (start of day). */
  from?: string;
  /** ISO date "YYYY-MM-DD" — inclusive upper bound (end of day). */
  to?: string;
};

export async function getFirmActivity(
  filter: FirmActivityFilter = {}
): Promise<FirmActivityRow[]> {
  const where: Prisma.ActivityLogWhereInput = {};
  if (filter.types && filter.types.length > 0) {
    where.type = { in: [...filter.types] };
  }
  if (filter.userId) {
    where.userId = filter.userId;
  }
  if (filter.from || filter.to) {
    const range: Prisma.DateTimeFilter = {};
    if (filter.from) {
      const d = new Date(filter.from);
      d.setHours(0, 0, 0, 0);
      range.gte = d;
    }
    if (filter.to) {
      const d = new Date(filter.to);
      d.setHours(23, 59, 59, 999);
      range.lte = d;
    }
    where.timestamp = range;
  }
  const rows = await prisma.activityLog.findMany({
    where,
    orderBy: { timestamp: "desc" },
    take: FIRM_ACTIVITY_LIMIT,
    include: {
      user: { select: { id: true, name: true, initials: true } },
      matter: { select: { id: true, name: true } },
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
    matterId: r.matter?.id ?? null,
    matterName: r.matter?.name ?? null,
    authorId: r.user?.id ?? null,
    authorName: r.user?.name ?? null,
    authorInitials: r.user?.initials ?? null,
  }));
}

/** Distinct list of users who appear as authors in the firm's
 *  activity log. Drives the user-filter dropdown on the audit
 *  page. */
export async function listFirmActivityAuthors(): Promise<
  Array<{ id: string; name: string; initials: string | null }>
> {
  const rows = await prisma.activityLog.findMany({
    where: { userId: { not: null } },
    select: {
      user: { select: { id: true, name: true, initials: true } },
    },
    distinct: ["userId"],
  });
  const seen = new Set<string>();
  const out: Array<{ id: string; name: string; initials: string | null }> = [];
  for (const r of rows) {
    if (!r.user || seen.has(r.user.id)) continue;
    seen.add(r.user.id);
    out.push({
      id: r.user.id,
      name: r.user.name,
      initials: r.user.initials ?? null,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
