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

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { TIME_ENTRY_WIP_STATUSES } from "@/lib/constants/time-entry-status";
import {
  addDaysToKey,
  daysUntilDateOnly,
  dateOnlyRange,
  todayKey,
} from "@/lib/format-date";
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
  /** Whole calendar days from the viewer's today to the earliest OPEN
   *  deadline: 0 = due today, negative = overdue (-12 = 12 days late).
   *  Null when the matter has no open deadline. */
  nextDeadlineDays: number | null;
  /** True if pinned by the current user (not a global property of the matter). */
  isPinned: boolean;
  isArchived: boolean;
  createdAt: Date;
};

/** Prisma `where` built from the filter — every filter, including the
 *  text search, is evaluated in the database so it can never be
 *  truncated by a row cap. `tz` is the viewer's zone: deadline
 *  windows are calendar days in the viewer's today (ADR-012), never
 *  the server's clock. */
function buildWhere(filter: MattersFilter, currentUserId: string, tz: string) {
  const where: Record<string, unknown> = {};

  if (filter.q) {
    // Case-insensitive match on name or case number (Postgres
    // `mode: "insensitive"`). Prisma does NOT escape LIKE wildcards in
    // `contains`, so a literal "%" / "_" typed in the search box is
    // escaped here to keep matching literally.
    const needle = filter.q.replace(/[\\%_]/g, "\\$&");
    where.OR = [
      { name: { contains: needle, mode: "insensitive" } },
      { caseNumber: { contains: needle, mode: "insensitive" } },
    ];
  }

  if (!filter.includeArchived) where.isArchived = false;
  if (filter.pinnedOnly) where.pins = { some: { userId: currentUserId } };
  if (filter.areas.length > 0)
    where.practiceArea = { name: { in: filter.areas } };

  // Stage filter and the show-closed toggle both constrain the stage
  // relation. Closed stages are hidden by default; `showClosed` opts
  // them back in. When both are active we AND them together via a
  // compound relation filter.
  const stageConds: Array<Record<string, unknown>> = [];
  if (filter.stages.length > 0)
    stageConds.push({ name: { in: filter.stages } });
  if (!filter.showClosed) stageConds.push({ isTerminal: false });
  if (stageConds.length === 1) where.stage = stageConds[0];
  else if (stageConds.length > 1) where.stage = { AND: stageConds };

  if (filter.feeStructures.length > 0)
    where.feeStructure = { in: filter.feeStructures };

  if (filter.leadIds.length > 0) {
    where.teamMembers = {
      // Match the active lead only — a former lead doesn't make
      // the matter "led by user X" anymore.
      some: {
        role: "lead",
        removedAt: null,
        userId: { in: filter.leadIds },
      },
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

  // Date-only deadlines are compared as calendar days against the
  // viewer's today: due-today is NOT overdue, overdue is strictly
  // before today. The within-N windows are open at the low end:
  // everything due before the start of day N+1, overdue included, so
  // a missed deadline never drops out of the "needs attention" view.
  const today = todayKey(tz);
  const startOfToday = dateOnlyRange(today, today).gte;
  switch (filter.deadline) {
    case "within-7d":
      where.deadlines = {
        some: {
          status: "open",
          dueDate: { lt: dateOnlyRange(today, addDaysToKey(today, 7)).lt },
        },
      };
      break;
    case "within-30d":
      where.deadlines = {
        some: {
          status: "open",
          dueDate: { lt: dateOnlyRange(today, addDaysToKey(today, 30)).lt },
        },
      };
      break;
    case "overdue":
      where.deadlines = {
        some: { status: "open", dueDate: { lt: startOfToday } },
      };
      break;
    case "none":
      where.deadlines = { none: { status: "open" } };
      break;
    // "any" — no constraint
  }

  return where;
}

/** Comparator for the in-memory sort. Pinned matters ALWAYS sort first,
 *  ahead of the chosen field (like the sidebar); the chosen field then
 *  orders each group. */
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

/// Maximum rows listMatters returns — covers a small/mid firm without a
/// real pagination UI. The cap is applied AFTER search, filters and
/// sort, so it can only truncate the tail of the user's own result
/// (the page shows "N of M" from countMatters). When a firm hits it,
/// build "Load more" / page controls.
const LIST_MATTERS_CAP = 200;

/// Safety bound on how many matching rows are pulled to sort in
/// memory (the sorts mirror localeCompare and derived fields the DB
/// can't order by). Rows are narrow; the newest are kept past it.
const LIST_MATTERS_SCAN_LIMIT = 5000;

/**
 * Matters matching `filter`, sorted by `sort` (pinned always first),
 * at most LIST_MATTERS_CAP rows. Text search and every filter run in
 * the database; only the ordering is applied in memory, over all
 * matching rows, before the cap.
 */
export async function listMatters(
  filter: MattersFilter = EMPTY_FILTER,
  sort: MattersSort = { field: "created", dir: "desc" },
  currentUserId?: string,
  tz?: string
): Promise<MatterListRow[]> {
  const userId = currentUserId ?? (await getCurrentUserId());
  const zone = tz ?? (await getCurrentUserTimeZone());
  const where = buildWhere(filter, userId, zone);
  const matters = await prisma.matter.findMany({
    where,
    take: LIST_MATTERS_SCAN_LIMIT,
    // Newest first so the safety bound (if ever hit) drops the oldest.
    orderBy: { createdAt: "desc" },
    include: {
      practiceArea: { select: { name: true } },
      stage: { select: { name: true, order: true, isTerminal: true } },
      teamMembers: {
        where: { role: "lead", removedAt: null },
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

  if (matters.length >= LIST_MATTERS_SCAN_LIMIT) {
    console.warn(
      `listMatters: scan limit ${LIST_MATTERS_SCAN_LIMIT} reached; the oldest matches are not sorted or shown`
    );
  }

  const rows: MatterListRow[] = matters.map((m) => ({
    id: m.id,
    name: m.name,
    caseNumber: m.caseNumber,
    area: m.practiceArea.name,
    stage: m.stage.name,
    stageOrder: m.stage.order,
    stageIsTerminal: m.stage.isTerminal,
    feeStructure: m.feeStructure,
    // Decimal → number at the API boundary so the row shape stays
    // primitive-only (matches comparator + display helpers). The DB
    // keeps Decimal precision; UI doesn't need it.
    trustBalance: m.trustBalance.toNumber(),
    color: m.color,
    leadInitials: m.teamMembers[0]?.user.initials ?? null,
    leadName: m.teamMembers[0]?.user.name ?? null,
    nextDeadlineDays: m.deadlines[0]
      ? daysUntilDateOnly(m.deadlines[0].dueDate, zone)
      : null,
    isPinned: m.pins.length > 0,
    isArchived: m.isArchived,
    createdAt: m.createdAt,
  }));

  return rows.sort(makeComparator(sort)).slice(0, LIST_MATTERS_CAP);
}

/**
 * Count of matters matching `filter`, evaluated entirely in the DB —
 * not subject to LIST_MATTERS_CAP. Uses the same `buildWhere` as
 * `listMatters` (text search included), so it is the exact "showing N
 * of M" denominator for what the list can return.
 */
export async function countMatters(
  filter: MattersFilter = EMPTY_FILTER,
  currentUserId?: string,
  tz?: string
): Promise<number> {
  const userId = currentUserId ?? (await getCurrentUserId());
  const zone = tz ?? (await getCurrentUserTimeZone());
  return prisma.matter.count({ where: buildWhere(filter, userId, zone) });
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
 * areas). Fee structures are the distinct values in use; lead options
 * are the ACTIVE leads of active users (what the lead filter matches).
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
    prisma.matter.findMany({
      distinct: ["feeStructure"],
      select: { feeStructure: true },
    }),
    prisma.matterTeamMember.findMany({
      // Same predicate as buildWhere's lead filter (active lead rows).
      // Deactivated users are intentionally hidden from the filter
      // options, even though they can remain lead on existing matters.
      where: { role: "lead", removedAt: null, user: { isActive: true } },
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
 *
 * Wrapped in React `cache()` so the [id] layout and the active tab page
 * share one DB round-trip per request instead of each running the query.
 */
export const getMatterById = cache(async (id: string) => {
  const userId = await getCurrentUserId();
  const matter = await prisma.matter.findUnique({
    where: { id },
    // The stored wipAmount column is stale (never maintained) — omit it.
    omit: { wipAmount: true },
    include: {
      practiceArea: {
        select: {
          id: true,
          name: true,
          color: true,
          hasStatuteOfLimitations: true,
          statutePeriodDays: true,
          statuteSourceCitation: true,
        },
      },
      stage: {
        select: { id: true, name: true, order: true, isTerminal: true },
      },
      client: true,
      teamMembers: {
        include: {
          user: {
            select: { id: true, name: true, initials: true, jobTitle: true },
          },
        },
        // Active first, then alphabetic by role within each bucket so
        // the overview's roster always reads the same way. Postgres
        // sorts NULLs LAST on ASC, so ask for them first explicitly.
        orderBy: [
          { removedAt: { sort: "asc", nulls: "first" } },
          { role: "asc" },
        ],
      },
      pins: {
        where: { userId },
        select: { userId: true },
        take: 1,
      },
    },
  });
  if (!matter) return null;
  // WIP is computed live with the Billing tab's predicate (billable,
  // not no-charge, not on an invoice, WIP-eligible status). The stored
  // Matter.wipAmount column is never maintained, so it is dropped.
  const wipAgg = await prisma.timeEntry.aggregate({
    where: {
      matterId: id,
      billable: true,
      noCharge: false,
      invoiceId: null,
      status: { in: [...TIME_ENTRY_WIP_STATUSES] },
    },
    _sum: { amount: true },
  });
  const { pins, practiceArea, stage, trustBalance, ...rest } = matter;
  return {
    ...rest,
    // Flattened for display. Components that already used `matter.area`
    // and `matter.stage` as strings keep working.
    area: practiceArea.name,
    stage: stage.name,
    practiceAreaId: practiceArea.id,
    practiceAreaColor: practiceArea.color,
    practiceAreaHasStatuteOfLimitations: practiceArea.hasStatuteOfLimitations,
    practiceAreaStatutePeriodDays: practiceArea.statutePeriodDays,
    practiceAreaStatuteSourceCitation: practiceArea.statuteSourceCitation,
    stageId: stage.id,
    stageOrder: stage.order,
    stageIsTerminal: stage.isTerminal,
    isPinnedByCurrentUser: pins.length > 0,
    // Decimal → number at the API boundary so consumers stay
    // primitive-typed. The DB keeps Decimal precision.
    trustBalance: trustBalance.toNumber(),
    wipAmount: wipAgg._sum.amount?.toNumber() ?? 0,
  };
});

export type MatterDetail = NonNullable<Awaited<ReturnType<typeof getMatterById>>>;
