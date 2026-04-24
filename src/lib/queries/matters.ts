/**
 * Matters Queries
 *
 * Server-only data access for the matters list and matter detail pages.
 * Detail lookups use the matter's `id` (cuid) — matter names are not
 * guaranteed unique (two Alvarez cases can coexist), so the opaque cuid
 * is the durable identifier.
 */

import { prisma } from "@/lib/prisma";
import {
  EMPTY_FILTER,
  STAGE_ORDER,
  type MattersFilter,
  type MattersSort,
} from "@/lib/matters-filters";

export type MatterListRow = {
  id: string;
  name: string;
  caseNumber: string | null;
  area: string;
  stage: string;
  feeStructure: string;
  trustBalance: number;
  color: string;
  leadInitials: string | null;
  leadName: string | null;
  nextDeadlineDays: number | null;
  isPinned: boolean;
  isArchived: boolean;
  createdAt: Date;
};

/** Prisma `where` built from the filter. Some filters (text search, sort
 *  on derived fields) are applied in memory after fetch — those are
 *  handled in `listMatters` below. */
function buildWhere(filter: MattersFilter) {
  const where: Record<string, unknown> = {};

  if (!filter.includeArchived) where.isArchived = false;
  if (filter.pinnedOnly) where.isPinned = true;
  if (filter.areas.length > 0) where.area = { in: filter.areas };

  // Stage filter combines with hideClosed.
  const stageClauses: Array<Record<string, unknown>> = [];
  if (filter.stages.length > 0) stageClauses.push({ stage: { in: filter.stages } });
  if (filter.hideClosed)
    stageClauses.push({ stage: { notIn: ["Closed", "Settled"] } });
  if (stageClauses.length === 1) Object.assign(where, stageClauses[0]);
  else if (stageClauses.length > 1) where.AND = stageClauses;

  if (filter.feeStructures.length > 0)
    where.feeStructure = { in: filter.feeStructures };

  if (filter.leadIds.length > 0) {
    where.teamMembers = {
      some: { role: "lead", userId: { in: filter.leadIds } },
    };
  }

  switch (filter.trust) {
    case "has":
      where.trustBalance = { gt: 0 };
      break;
    case "none":
      where.trustBalance = { equals: 0 };
      break;
    case "over-10k":
      where.trustBalance = { gte: 10000 };
      break;
    // "any" — no constraint
  }

  const now = new Date();
  const inDays = (n: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + n);
    d.setHours(23, 59, 59, 999);
    return d;
  };
  switch (filter.deadline) {
    case "within-7d":
      where.deadlines = {
        some: { status: "open", dueDate: { lte: inDays(7) } },
      };
      break;
    case "within-30d":
      where.deadlines = {
        some: { status: "open", dueDate: { lte: inDays(30) } },
      };
      break;
    case "overdue":
      where.deadlines = {
        some: { status: "open", dueDate: { lt: now } },
      };
      break;
    case "none":
      where.deadlines = { none: { status: "open" } };
      break;
    // "any" — no constraint
  }

  return where;
}

/** Comparator for in-memory sort. Pinned always wins as a tiebreaker. */
function makeComparator(sort: MattersSort) {
  const mul = sort.dir === "asc" ? 1 : -1;
  const stageIdx = (s: string) => {
    const i = (STAGE_ORDER as readonly string[]).indexOf(s);
    return i === -1 ? 999 : i;
  };

  return (a: MatterListRow, b: MatterListRow): number => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;

    let diff = 0;
    switch (sort.field) {
      case "name":
        diff = a.name.localeCompare(b.name);
        break;
      case "area":
        diff = a.area.localeCompare(b.area);
        break;
      case "lead":
        diff = (a.leadInitials ?? "~").localeCompare(b.leadInitials ?? "~");
        break;
      case "stage":
        diff = stageIdx(a.stage) - stageIdx(b.stage);
        break;
      case "fee":
        diff = a.feeStructure.localeCompare(b.feeStructure);
        break;
      case "trust":
        diff = a.trustBalance - b.trustBalance;
        break;
      case "deadline": {
        const aD = a.nextDeadlineDays ?? Number.POSITIVE_INFINITY;
        const bD = b.nextDeadlineDays ?? Number.POSITIVE_INFINITY;
        diff = aD - bD;
        break;
      }
      case "created":
        diff = a.createdAt.getTime() - b.createdAt.getTime();
        break;
    }
    return diff * mul;
  };
}

/**
 * All matters matching `filter`, sorted by `sort` (pinned always first).
 * Text search (`filter.q`) is applied in memory after the DB round-trip —
 * SQLite doesn't support `mode: 'insensitive'` and this dataset is small.
 */
export async function listMatters(
  filter: MattersFilter = EMPTY_FILTER,
  sort: MattersSort = { field: "created", dir: "desc" }
): Promise<MatterListRow[]> {
  const where = buildWhere(filter);
  const matters = await prisma.matter.findMany({
    where,
    include: {
      teamMembers: {
        where: { role: "lead" },
        take: 1,
        include: { user: { select: { initials: true, name: true } } },
      },
      deadlines: {
        where: { status: "open" },
        orderBy: { dueDate: "asc" },
        take: 1,
        select: { dueDate: true },
      },
    },
  });

  const now = Date.now();
  const rows: MatterListRow[] = matters.map((m) => ({
    id: m.id,
    name: m.name,
    caseNumber: m.caseNumber,
    area: m.area,
    stage: m.stage,
    feeStructure: m.feeStructure,
    trustBalance: m.trustBalance,
    color: m.color,
    leadInitials: m.teamMembers[0]?.user.initials ?? null,
    leadName: m.teamMembers[0]?.user.name ?? null,
    nextDeadlineDays: m.deadlines[0]
      ? Math.max(
          0,
          Math.ceil(
            (m.deadlines[0].dueDate.getTime() - now) / (24 * 60 * 60 * 1000)
          )
        )
      : null,
    isPinned: m.isPinned,
    isArchived: m.isArchived,
    createdAt: m.createdAt,
  }));

  // In-memory text search (case-insensitive, matches name + case number).
  const filtered = filter.q
    ? rows.filter((r) => {
        const needle = filter.q.toLowerCase();
        return (
          r.name.toLowerCase().includes(needle) ||
          (r.caseNumber ?? "").toLowerCase().includes(needle)
        );
      })
    : rows;

  return filtered.sort(makeComparator(sort));
}

/** Filter options surfaced in the toolbar popovers. */
export type MattersFilterOptions = {
  areas: string[];
  stages: string[];
  feeStructures: string[];
  leads: Array<{ id: string; name: string; initials: string }>;
};

/** Queries the distinct values present in the DB + the set of users
 *  who lead at least one matter. Ordered for stable UI. */
export async function getMattersFilterOptions(): Promise<MattersFilterOptions> {
  const [matters, leadAssignments] = await Promise.all([
    prisma.matter.findMany({
      select: { area: true, stage: true, feeStructure: true },
    }),
    prisma.matterTeamMember.findMany({
      where: { role: "lead" },
      distinct: ["userId"],
      include: { user: { select: { id: true, name: true, initials: true } } },
      orderBy: { user: { name: "asc" } },
    }),
  ]);

  const areas = Array.from(new Set(matters.map((m) => m.area))).sort();
  const stages = Array.from(new Set(matters.map((m) => m.stage))).sort(
    (a, b) => {
      const stageIdx = (s: string) => {
        const i = (STAGE_ORDER as readonly string[]).indexOf(s);
        return i === -1 ? 999 : i;
      };
      return stageIdx(a) - stageIdx(b);
    }
  );
  const feeStructures = Array.from(
    new Set(matters.map((m) => m.feeStructure))
  ).sort();
  const leads = leadAssignments.map((a) => ({
    id: a.user.id,
    name: a.user.name,
    initials: a.user.initials,
  }));

  return { areas, stages, feeStructures, leads };
}

/**
 * Single matter with the relations needed for the detail header.
 * Returns `null` if the id doesn't exist — callers should `notFound()`.
 */
export async function getMatterById(id: string) {
  return prisma.matter.findUnique({
    where: { id },
    include: {
      client: true,
      teamMembers: {
        include: {
          user: {
            select: { id: true, name: true, initials: true, role: true },
          },
        },
        orderBy: { role: "asc" },
      },
    },
  });
}

export type MatterDetail = NonNullable<Awaited<ReturnType<typeof getMatterById>>>;
