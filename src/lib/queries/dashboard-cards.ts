/**
 * Data for the smaller dashboard cards: pinned matters, upcoming SOLs,
 * time this week, new leads and unbilled time.
 *
 * Every query is scoped to what the viewer could already see elsewhere:
 * matter rows go through the matter wall (`matterAccessWhere`), leads
 * through the lead wall (`leadAccessWhere`), and unbilled amounts need
 * `billing.view` in the query itself (ADR-038). Dates follow ADR-012:
 * SOL and due dates are date-only values counted against the viewer's
 * day key.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { getFirmGoals } from "@/lib/firm";
import { currentUserHasPermission } from "@/lib/permission-check";
import { matterAccessWhere, matterRelationAccessWhere } from "@/lib/matter-access";
import { leadAccessWhere } from "@/lib/lead-access";
import { getMyWeekTime, type MyWeekTime } from "@/lib/queries/time";
import { TIME_ENTRY_WIP_STATUSES } from "@/lib/constants/time-entry-status";
import { LEAD_CLOSED_STAGES } from "@/lib/constants/lead-stage";
import {
  addDaysToKey,
  dateOnlyRange,
  daysUntilDateOnly,
  instantInTz,
  todayKey,
} from "@/lib/format-date";

// ── Pinned matters ──────────────────────────────────────────────────────

export const PINNED_LIMIT = 10;

export type PinnedMatterItem = {
  id: string;
  name: string;
  color: string;
  stageName: string;
  /** The matter's soonest open deadline, if any. */
  nextDeadline: { title: string; dueDate: Date; days: number } | null;
};

/** The viewer's own pins (same list as the sidebar), most recent first.
 *  A pin on a matter the viewer can no longer see, or an archived one,
 *  drops out. */
export async function getPinnedMatters(tz: string): Promise<PinnedMatterItem[]> {
  const userId = await getCurrentUserId();
  const access = await matterAccessWhere(userId);
  const pins = await prisma.userMatterPin.findMany({
    where: { userId, matter: { ...access, isArchived: false } },
    orderBy: { createdAt: "desc" },
    take: PINNED_LIMIT,
    select: {
      matter: {
        select: {
          id: true,
          name: true,
          color: true,
          stage: { select: { name: true } },
          deadlines: {
            where: { status: "open" },
            orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
            take: 1,
            select: { title: true, dueDate: true },
          },
        },
      },
    },
  });
  return pins.map(({ matter: m }) => {
    const next = m.deadlines[0];
    return {
      id: m.id,
      name: m.name,
      color: m.color,
      stageName: m.stage.name,
      nextDeadline: next
        ? { title: next.title, dueDate: next.dueDate, days: daysUntilDateOnly(next.dueDate, tz) }
        : null,
    };
  });
}

// ── Upcoming SOLs ───────────────────────────────────────────────────────

export const SOL_WINDOW_DAYS = 90;
export const SOL_LIMIT = 10;

export type SolItem = {
  matterId: string;
  matterName: string;
  /** Date-only SOL date (UTC midnight). */
  solDate: Date;
  /** Whole days from the viewer's today; negative = lapsed. */
  days: number;
};

export type SolsData = {
  items: SolItem[];
  hidden: number;
  /** Every lapsed SOL, including any past the row cap. */
  lapsed: number;
};

/** Unsatisfied SOLs due within the window (lapsed ones included, most
 *  urgent first) on accessible, open, non-archived matters. */
export async function getUpcomingSols(tz: string): Promise<SolsData> {
  const userId = await getCurrentUserId();
  const access = await matterAccessWhere(userId);
  const today = todayKey(tz);
  const lastKey = addDaysToKey(today, SOL_WINDOW_DAYS);
  const where: Prisma.MatterWhereInput = {
    ...access,
    isArchived: false,
    stage: { isTerminal: false },
    statuteOfLimitationsSatisfied: false,
    statuteOfLimitationsDate: { lt: dateOnlyRange(lastKey, lastKey).lt },
  };
  const [rows, total, lapsed] = await Promise.all([
    prisma.matter.findMany({
      where,
      orderBy: [{ statuteOfLimitationsDate: "asc" }, { name: "asc" }],
      take: SOL_LIMIT,
      select: { id: true, name: true, statuteOfLimitationsDate: true },
    }),
    prisma.matter.count({ where }),
    prisma.matter.count({
      where: {
        ...where,
        statuteOfLimitationsDate: { lt: dateOnlyRange(today, today).gte },
      },
    }),
  ]);
  return {
    lapsed,
    items: rows.map((m) => ({
      matterId: m.id,
      matterName: m.name,
      solDate: m.statuteOfLimitationsDate!,
      days: daysUntilDateOnly(m.statuteOfLimitationsDate!, tz),
    })),
    hidden: Math.max(0, total - rows.length),
  };
}

// ── Time this week ──────────────────────────────────────────────────────

export type TimeWeekData = MyWeekTime & {
  dailyGoal: number;
  /** The viewer's today, to mark it in the chart. */
  todayKey: string;
};

/** The 7 day keys (Sunday first, matching /time and the calendar) of the
 *  week containing `today`. */
export function weekKeysContaining(today: string): string[] {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const sunday = addDaysToKey(today, -dow);
  return Array.from({ length: 7 }, (_, i) => addDaysToKey(sunday, i));
}

/** The viewer's own hours per day this week (same numbers as /time). */
export async function getTimeThisWeek(tz: string): Promise<TimeWeekData> {
  const today = todayKey(tz);
  const [week, goals] = await Promise.all([
    getMyWeekTime(weekKeysContaining(today)),
    getFirmGoals(),
  ]);
  return { ...week, dailyGoal: goals.dailyHoursGoal, todayKey: today };
}

// ── New leads ───────────────────────────────────────────────────────────

export const NEW_LEADS_DAYS = 7;
export const NEW_LEADS_LIMIT = 5;

export type NewLeadItem = {
  id: string;
  name: string;
  source: string | null;
  stage: string;
  createdAt: Date;
};

export type NewLeadsData = { items: NewLeadItem[]; hidden: number };

/** Open leads the viewer may see that were created in the last 7 of
 *  the viewer's calendar days (today included), newest first. */
export async function getNewLeads(tz: string): Promise<NewLeadsData> {
  const userId = await getCurrentUserId();
  const [y, m, d] = addDaysToKey(todayKey(tz), -(NEW_LEADS_DAYS - 1))
    .split("-")
    .map(Number) as [number, number, number];
  const where: Prisma.LeadWhereInput = {
    ...(await leadAccessWhere(userId)),
    stage: { notIn: [...LEAD_CLOSED_STAGES] },
    createdAt: { gte: instantInTz(y, m, d, 0, 0, tz) },
  };
  const [rows, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: NEW_LEADS_LIMIT,
      select: {
        id: true,
        name: true,
        source: true,
        stage: true,
        createdAt: true,
        contact: { select: { name: true } },
      },
    }),
    prisma.lead.count({ where }),
  ]);
  return {
    items: rows.map((l) => ({
      id: l.id,
      name: l.contact?.name ?? l.name,
      source: l.source,
      stage: l.stage,
      createdAt: l.createdAt,
    })),
    hidden: Math.max(0, total - rows.length),
  };
}

// ── Unbilled time ───────────────────────────────────────────────────────

export const UNBILLED_LIMIT = 5;

export type UnbilledMatterItem = {
  matterId: string;
  matterName: string;
  hours: number;
  amount: number;
};

export type UnbilledData = {
  items: UnbilledMatterItem[];
  /** Matters with unbilled time beyond the top rows. */
  hidden: number;
  totalHours: number;
  totalAmount: number;
};

/** Unbilled (WIP) time on accessible matters: the matters with the most
 *  unbilled value plus firm totals. Same predicate as the matter
 *  Billing tab's WIP. `null` without `billing.view`, before any query
 *  runs. */
export async function getUnbilledTime(): Promise<UnbilledData | null> {
  if (!(await currentUserHasPermission("billing.view"))) return null;
  const userId = await getCurrentUserId();
  const [access, relationAccess] = await Promise.all([
    matterAccessWhere(userId),
    matterRelationAccessWhere(userId),
  ]);
  const wip = {
    billable: true,
    noCharge: false,
    invoiceId: null,
    status: { in: [...TIME_ENTRY_WIP_STATUSES] },
  } satisfies Prisma.TimeEntryWhereInput;
  const where: Prisma.TimeEntryWhereInput = { ...wip, matterId: { not: null }, ...relationAccess };
  // Rank on priced entries: Prisma can't sort NULL sums last, and a
  // matter whose time has no rate would otherwise lead the list.
  const [ranked, totals, matterCount] = await Promise.all([
    prisma.timeEntry.groupBy({
      by: ["matterId"],
      where: { ...where, amount: { not: null } },
      _sum: { amount: true },
      orderBy: { _sum: { amount: "desc" } },
      take: UNBILLED_LIMIT,
    }),
    prisma.timeEntry.aggregate({ where, _sum: { hours: true, amount: true } }),
    prisma.matter.count({ where: { ...access, timeEntries: { some: wip } } }),
  ]);
  const topIds = ranked.map((g) => g.matterId as string);
  // Full hours and amount for the top matters, unpriced entries included.
  const [sums, matters] = await Promise.all([
    prisma.timeEntry.groupBy({
      by: ["matterId"],
      where: { ...where, matterId: { in: topIds } },
      _sum: { hours: true, amount: true },
    }),
    prisma.matter.findMany({
      where: { ...access, id: { in: topIds } },
      select: { id: true, name: true },
    }),
  ]);
  const sumById = new Map(sums.map((g) => [g.matterId as string, g._sum]));
  const nameById = new Map(matters.map((m) => [m.id, m.name]));
  return {
    items: topIds.map((id) => ({
      matterId: id,
      matterName: nameById.get(id) ?? "Matter",
      hours: Math.round((sumById.get(id)?.hours ?? 0) * 100) / 100,
      // Decimal -> number at the view boundary, like the other cards.
      amount: sumById.get(id)?.amount?.toNumber() ?? 0,
    })),
    hidden: Math.max(0, matterCount - topIds.length),
    totalHours: Math.round((totals._sum.hours ?? 0) * 100) / 100,
    totalAmount: totals._sum.amount?.toNumber() ?? 0,
  };
}
