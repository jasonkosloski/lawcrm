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
import { addDaysToKey, instantInTz } from "@/lib/format-date";
import { getCurrentUserId } from "@/lib/current-user";
import { optionalRecordAccessClause } from "@/lib/matter-access";
import {
  activityMoneyFilters,
  resolveActivityMoneyAccess,
} from "@/lib/activity-money-filters";

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

/** Row cap on the firm activity log; the page says so when it's hit. */
export const FIRM_ACTIVITY_LIMIT = 200;

export type FirmActivityFilter = {
  types?: readonly string[];
  userId?: string;
  /** Whose matter access scopes the rows; defaults to the session user. */
  viewerId?: string;
  /** "YYYY-MM-DD" — inclusive lower bound: the start of that calendar
   *  day in `tz`. Malformed values are ignored. */
  from?: string;
  /** "YYYY-MM-DD" — inclusive upper bound: through the end of that
   *  calendar day in `tz`. Malformed values are ignored. */
  to?: string;
  /** The VIEWER's IANA zone. ActivityLog.timestamp is a real instant
   *  shown in this zone on the page, so the day filters must cut on
   *  the same calendar days (the page passes getCurrentUserTimeZone()).
   *  Defaults to UTC when omitted. */
  tz?: string;
};

const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Start-of-day instant for a YYYY-MM-DD key in `tz`; null when the
 *  key is malformed or not a real calendar date. */
function startOfDayInstant(key: string, tz: string): Date | null {
  const m = DAY_KEY_RE.exec(key);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== mo - 1 ||
    probe.getUTCDate() !== d
  ) {
    return null;
  }
  return instantInTz(y, mo, d, 0, 0, tz);
}

export async function getFirmActivity(
  filter: FirmActivityFilter = {}
): Promise<FirmActivityRow[]> {
  const viewerId = filter.viewerId ?? (await getCurrentUserId());
  // Ethical walls: rows on a hidden matter are not listed (firm-scope
  // rows with no matter stay).
  const [matterClause, moneyAccess] = await Promise.all([
    optionalRecordAccessClause(viewerId),
    resolveActivityMoneyAccess(),
  ]);
  const where: Prisma.ActivityLogWhereInput = {
    AND: [
      ...(matterClause as Prisma.ActivityLogWhereInput[]),
      // Settlement / trust / expense amounts need their own view keys
      // here too — firm.view_activity is the audit trail, not every
      // number in it (F085 / F145).
      ...activityMoneyFilters(moneyAccess),
    ],
  };
  if (filter.types && filter.types.length > 0) {
    where.type = { in: [...filter.types] };
  }
  if (filter.userId) {
    where.userId = filter.userId;
  }
  const tz = filter.tz ?? "UTC";
  const range: Prisma.DateTimeFilter = {};
  const gte = filter.from ? startOfDayInstant(filter.from, tz) : null;
  if (gte) range.gte = gte;
  // Half-open: before the start of the day AFTER `to` (DST-safe, and
  // no 23:59:59.999 off-by-a-millisecond edge).
  const lt =
    filter.to && startOfDayInstant(filter.to, tz)
      ? startOfDayInstant(addDaysToKey(filter.to, 1), tz)
      : null;
  if (lt) range.lt = lt;
  if (gte || lt) where.timestamp = range;
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
 *  page.
 *
 *  Uses `groupBy` (real SQL GROUP BY) rather than
 *  `findMany({ distinct })` — Prisma dedupes `distinct` in-memory
 *  in the query engine, which would materialize every ActivityLog
 *  row (the fastest-growing table in the app) just to fill a
 *  dropdown. */
export async function listFirmActivityAuthors(
  viewerIdArg?: string
): Promise<Array<{ id: string; name: string; initials: string | null }>> {
  const viewerId = viewerIdArg ?? (await getCurrentUserId());
  const grouped = await prisma.activityLog.groupBy({
    by: ["userId"],
    where: {
      userId: { not: null },
      AND: (await optionalRecordAccessClause(viewerId)) as Prisma.ActivityLogWhereInput[],
    },
  });
  const userIds = grouped
    .map((g) => g.userId)
    .filter((id): id is string => id !== null);
  if (userIds.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, initials: true },
  });
  return users
    .map((u) => ({
      id: u.id,
      name: u.name,
      initials: u.initials ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
