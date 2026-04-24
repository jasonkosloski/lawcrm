/**
 * Matters Queries
 *
 * Server-only data access for the matters list and matter detail pages.
 * Detail lookups use the matter's `id` (cuid) — matter names are not
 * guaranteed unique (two Alvarez cases can coexist), so the opaque cuid
 * is the durable identifier.
 *
 * Practice areas + stages now live in dedicated lookup tables. URL
 * filter params still use human names (e.g. ?area=§1983&stage=Discovery)
 * for readability and shareability — the queries below translate those
 * names into FK filters via Prisma relation filtering. Sort-by-stage
 * uses `stage.order` joined from the DB, not a hardcoded list.
 */

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import {
  EMPTY_FILTER,
  type MattersFilter,
  type MattersSort,
} from "@/lib/matters-filters";

export type MatterListRow = {
  id: string;
  name: string;
  caseNumber: string | null;
  area: string;
  stage: string;
  /** Order of this stage within its practice area — used for sort-by-stage. */
  stageOrder: number;
  /** True when the stage is a closing state (Settled/Closed-equivalent). */
  stageIsTerminal: boolean;
  feeStructure: string;
  trustBalance: number;
  color: string;
  leadInitials: string | null;
  leadName: string | null;
  nextDeadlineDays: number | null;
  /** True if pinned by the current user (not a global property of the matter). */
  isPinned: boolean;
  isArchived: boolean;
  createdAt: Date;
};

/** Prisma `where` built from the filter. Some filters (text search, sort
 *  on derived fields) are applied in memory after fetch — those are
 *  handled in `listMatters` below. */
function buildWhere(filter: MattersFilter, currentUserId: string) {
  const where: Record<string, unknown> = {};

  if (!filter.includeArchived) where.isArchived = false;
  if (filter.pinnedOnly) where.pins = { some: { userId: currentUserId } };
  if (filter.areas.length > 0)
    where.practiceArea = { name: { in: filter.areas } };

  // Stage filter and hideClosed both constrain the stage relation.
  // When both are active we AND them together via a compound relation filter.
  const stageConds: Array<Record<string, unknown>> = [];
  if (filter.stages.length > 0)
    stageConds.push({ name: { in: filter.stages } });
  if (filter.hideClosed) stageConds.push({ isTerminal: false });
  if (stageConds.length === 1) where.stage = stageConds[0];
  else if (stageConds.length > 1) where.stage = { AND: stageConds };

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
        diff = a.stageOrder - b.stageOrder;
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
  sort: MattersSort = { field: "created", dir: "desc" },
  currentUserId?: string
): Promise<MatterListRow[]> {
  const userId = currentUserId ?? (await getCurrentUserId());
  const where = buildWhere(filter, userId);
  const matters = await prisma.matter.findMany({
    where,
    include: {
      practiceArea: { select: { name: true } },
      stage: { select: { name: true, order: true, isTerminal: true } },
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
      // Pin fetched as a conditional include so we can tell if the *current
      // user* has this matter pinned without a second query.
      pins: {
        where: { userId },
        select: { userId: true },
        take: 1,
      },
    },
  });

  const now = Date.now();
  const rows: MatterListRow[] = matters.map((m) => ({
    id: m.id,
    name: m.name,
    caseNumber: m.caseNumber,
    area: m.practiceArea.name,
    stage: m.stage.name,
    stageOrder: m.stage.order,
    stageIsTerminal: m.stage.isTerminal,
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
    isPinned: m.pins.length > 0,
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

/**
 * Returns the active practice areas + the union of their stage names
 * (de-duplicated, sorted by the canonical order they appear across
 * areas). Fee structures + lead options are derived from matters.
 */
export async function getMattersFilterOptions(): Promise<MattersFilterOptions> {
  const [areas, stages, matters, leadAssignments] = await Promise.all([
    prisma.practiceArea.findMany({
      where: { isActive: true },
      select: { name: true },
      orderBy: [{ order: "asc" }, { name: "asc" }],
    }),
    prisma.matterStage.findMany({
      where: { isActive: true },
      select: { name: true, order: true },
      orderBy: [{ order: "asc" }, { name: "asc" }],
    }),
    prisma.matter.findMany({ select: { feeStructure: true } }),
    prisma.matterTeamMember.findMany({
      where: { role: "lead" },
      distinct: ["userId"],
      include: { user: { select: { id: true, name: true, initials: true } } },
      orderBy: { user: { name: "asc" } },
    }),
  ]);

  // Dedupe stage names across areas, keeping the earliest `order` seen
  // so the filter list reads as a single lifecycle even if different
  // areas have slightly different stage sets.
  const stageFirstOrder = new Map<string, number>();
  for (const s of stages) {
    if (!stageFirstOrder.has(s.name))
      stageFirstOrder.set(s.name, s.order);
  }
  const orderedStageNames = Array.from(stageFirstOrder.entries())
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);

  const feeStructures = Array.from(
    new Set(matters.map((m) => m.feeStructure))
  ).sort();
  const leads = leadAssignments.map((a) => ({
    id: a.user.id,
    name: a.user.name,
    initials: a.user.initials,
  }));

  return {
    areas: areas.map((a) => a.name),
    stages: orderedStageNames,
    feeStructures,
    leads,
  };
}

/**
 * Single matter with the relations needed for the detail header.
 * Returns `null` if the id doesn't exist — callers should `notFound()`.
 * The returned object includes `isPinnedByCurrentUser` for the pin toggle
 * and flattens area/stage names so existing components read them as
 * scalar strings.
 */
export async function getMatterById(id: string) {
  const userId = await getCurrentUserId();
  const matter = await prisma.matter.findUnique({
    where: { id },
    include: {
      practiceArea: {
        select: { id: true, name: true, color: true },
      },
      stage: {
        select: { id: true, name: true, order: true, isTerminal: true },
      },
      client: true,
      teamMembers: {
        include: {
          user: {
            select: { id: true, name: true, initials: true, role: true },
          },
        },
        orderBy: { role: "asc" },
      },
      pins: {
        where: { userId },
        select: { userId: true },
        take: 1,
      },
    },
  });
  if (!matter) return null;
  const { pins, practiceArea, stage, ...rest } = matter;
  return {
    ...rest,
    // Flattened for display. Components that already used `matter.area`
    // and `matter.stage` as strings keep working.
    area: practiceArea.name,
    stage: stage.name,
    practiceAreaId: practiceArea.id,
    practiceAreaColor: practiceArea.color,
    stageId: stage.id,
    stageOrder: stage.order,
    stageIsTerminal: stage.isTerminal,
    isPinnedByCurrentUser: pins.length > 0,
  };
}

export type MatterDetail = NonNullable<Awaited<ReturnType<typeof getMatterById>>>;
