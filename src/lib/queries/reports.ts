/**
 * Reports Queries
 *
 * Server-only data access for the /reports dashboard — four
 * firm-wide report sections, one exported function each:
 *
 *   - getPipelineReport    — intake leads by stage + open matters
 *                            by practice area × stage + conversion
 *                            context for the current quarter
 *   - getUtilizationReport — per-active-user hours this month
 *                            (billable vs total) against the firm's
 *                            capacity goals (read FRESH from the
 *                            Firm row on every call)
 *   - getArAgingReport     — outstanding client invoices bucketed
 *                            0–30 / 31–60 / 61–90 / 90+ days
 *   - getRealizationReport — trailing 3 months of worked → billed →
 *                            collected
 *
 * All Decimal columns convert to number at this boundary (same
 * convention as queries/dashboard.ts) — the Decimal stays canonical
 * in the DB; report display tolerates the precision floor.
 *
 * TZ (ADR-012): where a date range applies it's the VIEWER's
 * calendar, not the server's. Date-only columns (TimeEntry.date,
 * InvoicePayment.date) are calendar dates stored at UTC midnight, so
 * a month's bounds are UTC midnights of the viewer-tz month's first
 * day — never a server-local Date. Real instants (Lead.updatedAt)
 * get true UTC bounds via instantInTz.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { roundMoney } from "@/lib/money";
import { getCurrentUserId } from "@/lib/current-user";
import { filterAccessibleMatterIds, matterAccessWhere } from "@/lib/matter-access";
import {
  daysBetweenKeys,
  dateKeyInTz,
  dateOnlyKey,
  instantInTz,
  todayKey,
} from "@/lib/format-date";
import { LEAD_OPEN_STAGES, LEAD_STAGE_LABEL } from "@/lib/constants/lead-stage";

/** The viewer's current calendar date as [year, month, day] in their
 *  zone. Mirrors the private helper in queries/dashboard.ts. */
const todayYmdInTz = (tz: string): [number, number, number] =>
  dateKeyInTz(new Date(), tz).split("-").map(Number) as [number, number, number];

/** UTC midnight of the 1st of the viewer's month, shifted back
 *  `monthsBack` months (negative goes forward). Date.UTC normalizes
 *  month under/overflow. Correct bound for date-only columns, which
 *  store UTC midnight (ADR-012). */
const startOfMonthInTz = (tz: string, monthsBack = 0): Date => {
  const [y, m] = todayYmdInTz(tz);
  return new Date(Date.UTC(y, m - 1 - monthsBack, 1));
};

// ── Pipeline ────────────────────────────────────────────────────────────

/** Intake pipeline stages in funnel order. `converted` / `declined`
 *  are terminal — they leave the queue and only surface via the
 *  conversion context, not the stage bars. Derived from the
 *  centralized stage constants so a new stage shows up here without
 *  a second edit. */
const LEAD_PIPELINE_STAGES: readonly { stage: string; label: string }[] = LEAD_OPEN_STAGES.map(
  (stage) => ({
    stage,
    label: LEAD_STAGE_LABEL[stage],
  }),
);

export type PipelineReport = {
  /** Active intake queue, one row per pipeline stage (funnel order).
   *  Stages with zero leads still appear so the funnel shape reads. */
  leadsByStage: { stage: string; label: string; count: number }[];
  totalActiveLeads: number;
  /** Leads converted during the viewer's current calendar quarter.
   *  Lead has no convertedAt column, so the converted matter's
   *  createdAt dates the conversion (later edits and contact merges
   *  bump Lead.updatedAt and must not re-date it); a converted lead
   *  with no linked matter falls back to updatedAt. */
  convertedThisQuarter: number;
  /** Open (non-archived, non-terminal-stage) matters grouped
   *  practice area → stage. Areas ordered by their settings `order`;
   *  stages by lifecycle `order`; only stages with ≥1 matter listed. */
  areas: {
    areaId: string;
    name: string;
    label: string;
    color: string;
    total: number;
    stages: { stageId: string; name: string; count: number }[];
  }[];
  totalOpenMatters: number;
};

// Matter wall on /reports: money and hours roll-ups (utilization, A/R
// bucket totals, realization) stay FIRM-WIDE aggregates - the page is
// gated on reports.view and nothing in them names a matter. Anything
// that lists or counts MATTERS (open-matter pipeline, A/R worst
// offenders) is restricted to the viewer's accessible matters.
export async function getPipelineReport(tz: string): Promise<PipelineReport> {
  const mw = await matterAccessWhere(await getCurrentUserId());
  // Viewer-tz quarter start as a true instant — createdAt/updatedAt
  // are real timestamps, not date-only columns.
  const [y, m] = todayYmdInTz(tz);
  const quarterStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
  const quarterStart = instantInTz(y, quarterStartMonth, 1, 0, 0, tz);

  const [leadGroups, convertedCandidates, matterGroups, areas] = await Promise.all([
    // Firm-wide counts on purpose: reports.view aggregates ignore
    // the lead wall, as they ignore the matter wall (ADR-039/049).
    // No restricted lead is named here.
    prisma.lead.groupBy({ by: ["stage"], _count: true }),
    // updatedAt >= conversion time, so this is a superset of the
    // leads converted this quarter; the matter's createdAt narrows
    // it below.
    prisma.lead.findMany({
      where: { stage: "converted", updatedAt: { gte: quarterStart } },
      select: { convertedMatterId: true },
    }),
    prisma.matter.groupBy({
      by: ["practiceAreaId", "stageId"],
      where: { ...mw, isArchived: false, stage: { isTerminal: false } },
      _count: true,
    }),
    // Retired (inactive) areas still hold open matters — keep them
    // so the report's open-matter total matches the sidebar; areas
    // with no open matters are filtered out below.
    prisma.practiceArea.findMany({
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        label: true,
        color: true,
        stages: {
          orderBy: { order: "asc" },
          select: { id: true, name: true },
        },
      },
    }),
  ]);

  const linkedMatterIds = convertedCandidates
    .map((l) => l.convertedMatterId)
    .filter((id): id is string => id !== null);
  const unlinkedConverted = convertedCandidates.length - linkedMatterIds.length;
  const convertedThisQuarter =
    unlinkedConverted +
    (linkedMatterIds.length > 0
      ? await prisma.matter.count({
          where: {
            id: { in: linkedMatterIds },
            createdAt: { gte: quarterStart },
          },
        })
      : 0);

  const countByLeadStage = new Map(leadGroups.map((g) => [g.stage, g._count]));
  const leadsByStage = LEAD_PIPELINE_STAGES.map((s) => ({
    stage: s.stage,
    label: s.label,
    count: countByLeadStage.get(s.stage) ?? 0,
  }));

  const countByAreaStage = new Map(
    matterGroups.map((g) => [`${g.practiceAreaId}:${g.stageId}`, g._count]),
  );

  const areaRows = areas
    .map((a) => {
      const stages = a.stages
        .map((s) => ({
          stageId: s.id,
          name: s.name,
          count: countByAreaStage.get(`${a.id}:${s.id}`) ?? 0,
        }))
        .filter((s) => s.count > 0);
      return {
        areaId: a.id,
        name: a.name,
        label: a.label ?? a.name,
        color: a.color,
        total: stages.reduce((sum, s) => sum + s.count, 0),
        stages,
      };
    })
    .filter((a) => a.total > 0);

  return {
    leadsByStage,
    totalActiveLeads: leadsByStage.reduce((sum, s) => sum + s.count, 0),
    convertedThisQuarter,
    areas: areaRows,
    totalOpenMatters: areaRows.reduce((sum, a) => sum + a.total, 0),
  };
}

// ── Utilization ─────────────────────────────────────────────────────────

export type UtilizationReport = {
  /** One row per ACTIVE user, total hours desc. Users with zero
   *  entries this month still appear — "no hours logged" is exactly
   *  what a utilization report exists to surface. */
  users: {
    userId: string;
    name: string;
    initials: string;
    billableHours: number;
    totalHours: number;
  }[];
  /** Firm-wide billable hours this month (all users). */
  firmBillableMtd: number;
  /** Fresh reads from the Firm row — NOT the hardcoded dashboard
   *  constants. Settings edits show up on the next render. */
  monthlyBillableGoal: number;
  dailyHoursGoal: number;
  /** Per-person capacity context: dailyHoursGoal × business days
   *  (Mon–Fri) elapsed this month through the viewer's today,
   *  inclusive. A blunt instrument — no holiday calendar — but
   *  enough to read "ahead / behind pace" from the bars. */
  monthCapacityHours: number;
};

/** Mon–Fri days from the 1st of the viewer's month through their
 *  today, inclusive. Weekday computed from the plain Y-M-D triple
 *  in UTC, so the server zone can't skew it. */
const businessDaysElapsedInMonth = (tz: string): number => {
  const [y, m, today] = todayYmdInTz(tz);
  let count = 0;
  for (let day = 1; day <= today; day++) {
    const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
    if (dow >= 1 && dow <= 5) count++;
  }
  return count;
};

export async function getUtilizationReport(tz: string): Promise<UtilizationReport> {
  const userId = await getCurrentUserId();

  const [viewer, activeUsers, hourGroups] = await Promise.all([
    // Goals come off the viewer's firm row, fresh on every call.
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        firm: {
          select: { dailyHoursGoal: true, monthlyBillableGoal: true },
        },
      },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, initials: true },
    }),
    // One group per (user, billable-flag) — two rows max per user.
    prisma.timeEntry.groupBy({
      by: ["userId", "billable"],
      where: {
        date: { gte: startOfMonthInTz(tz), lt: startOfMonthInTz(tz, -1) },
      },
      _sum: { hours: true },
    }),
  ]);

  const dailyHoursGoal = viewer?.firm?.dailyHoursGoal ?? 6.0;
  const monthlyBillableGoal = viewer?.firm?.monthlyBillableGoal ?? 200;

  const byUser = new Map<string, { billable: number; total: number }>();
  let firmBillableMtd = 0;
  for (const g of hourGroups) {
    const hours = g._sum.hours ?? 0;
    const row = byUser.get(g.userId) ?? { billable: 0, total: 0 };
    row.total += hours;
    if (g.billable) {
      row.billable += hours;
      firmBillableMtd += hours;
    }
    byUser.set(g.userId, row);
  }

  const users = activeUsers
    .map((u) => {
      const hours = byUser.get(u.id) ?? { billable: 0, total: 0 };
      return {
        userId: u.id,
        name: u.name,
        initials: u.initials,
        billableHours: hours.billable,
        totalHours: hours.total,
      };
    })
    .sort((a, b) => b.totalHours - a.totalHours || a.name.localeCompare(b.name));

  return {
    users,
    firmBillableMtd,
    monthlyBillableGoal,
    dailyHoursGoal,
    monthCapacityHours: dailyHoursGoal * businessDaysElapsedInMonth(tz),
  };
}

// ── AR aging ────────────────────────────────────────────────────────────

/** Client-invoice statuses where money is owed (accounts receivable). */
export const AR_OPEN_STATUSES = ["sent", "partial"] as const;

/** Client-invoice statuses that count as "billed": the invoice has
 *  been issued to the client. (draft / approved are unsent; void is
 *  unlinked from its entries.) Exported so the dashboard's duplicate
 *  lists can share this source. */
export const BILLED_STATUSES = ["sent", "partial", "paid"] as const;

const AR_BUCKETS = [
  { key: "0-30", label: "0–30 days", min: 0, max: 30 },
  { key: "31-60", label: "31–60 days", min: 31, max: 60 },
  { key: "61-90", label: "61–90 days", min: 61, max: 90 },
  { key: "90+", label: "90+ days", min: 91, max: Infinity },
] as const;

export type ArBucketKey = (typeof AR_BUCKETS)[number]["key"];

export type ArAgingReport = {
  /** Fixed four buckets, oldest last, present even when empty. */
  buckets: { key: ArBucketKey; label: string; total: number; count: number }[];
  totalOutstanding: number;
  invoiceCount: number;
  /** Top 5 oldest outstanding invoices — the follow-up call list. */
  worstOffenders: {
    invoiceId: string;
    invoiceNumber: string;
    matterId: string;
    matterName: string;
    outstanding: number;
    daysOutstanding: number;
  }[];
};

/**
 * Outstanding client-kind invoices (status sent / partial — the two
 * AR states where money is owed), aged from issueDate. Bucket sums
 * stay Prisma Decimal until the final toNumber so partial payments
 * never accumulate float drift.
 *
 * issueDate is an INSTANT (generate stamps new Date(); send stamps
 * sentAt), so age is whole calendar days from its key IN THE VIEWER'S
 * ZONE to the viewer's today (ADR-012) — never a raw instant
 * difference, which would read every invoice a day older to a Denver
 * user in the evening and shift the 30/60/90 bucket edges.
 */
export async function getArAgingReport(tz: string): Promise<ArAgingReport> {
  const invoices = await prisma.invoice.findMany({
    where: { kind: "client", status: { in: [...AR_OPEN_STATUSES] } },
    orderBy: { issueDate: "asc" },
    select: {
      id: true,
      invoiceNumber: true,
      issueDate: true,
      totalAmount: true,
      paidAmount: true,
      matter: { select: { id: true, name: true } },
    },
  });

  const today = todayKey(tz);
  // Bucket totals are aggregate (stay firm-wide); the named offender
  // rows are restricted to matters the viewer can access.
  const accessible = await filterAccessibleMatterIds(
    await getCurrentUserId(),
    invoices.map((i) => i.matter.id),
  );

  // Bucket sums stay Decimal until the return — the whole point of
  // this report is money owed, so no float accumulation mid-flight.
  const bucketSums = AR_BUCKETS.map(() => ({
    total: new Prisma.Decimal(0),
    count: 0,
  }));

  const offenders: ArAgingReport["worstOffenders"] = [];
  let totalOutstanding = new Prisma.Decimal(0);
  let invoiceCount = 0;

  for (const inv of invoices) {
    const outstanding = inv.totalAmount.minus(inv.paidAmount);
    if (outstanding.lte(0)) continue; // fully paid but status not flipped — not AR

    // issueDate is an INSTANT (stamped new Date() at generate / sentAt
    // at send), so its calendar day is the viewer's, not UTC's.
    const age = Math.max(0, daysBetweenKeys(dateKeyInTz(inv.issueDate, tz), today));
    const idx = AR_BUCKETS.findIndex((b) => age >= b.min && age <= b.max);
    const bucket = bucketSums[idx >= 0 ? idx : AR_BUCKETS.length - 1];
    bucket.total = bucket.total.plus(outstanding);
    bucket.count += 1;
    totalOutstanding = totalOutstanding.plus(outstanding);
    invoiceCount += 1;

    // invoices arrive issueDate-asc, so the first five outstanding
    // rows ARE the five oldest.
    if (offenders.length < 5 && accessible.has(inv.matter.id)) {
      offenders.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        matterId: inv.matter.id,
        matterName: inv.matter.name,
        outstanding: outstanding.toNumber(),
        daysOutstanding: age,
      });
    }
  }

  return {
    buckets: AR_BUCKETS.map((b, i) => ({
      key: b.key,
      label: b.label,
      total: bucketSums[i].total.toNumber(),
      count: bucketSums[i].count,
    })),
    totalOutstanding: totalOutstanding.toNumber(),
    invoiceCount,
    worstOffenders: offenders,
  };
}

// ── Realization ─────────────────────────────────────────────────────────

export type RealizationMonth = {
  /** YYYY-MM in the viewer's calendar. */
  key: string;
  /** "May 2026" — display label. */
  label: string;
  /** Billable hours worked (regardless of invoicing). */
  workedHours: number;
  /** Billable hours already rolled into an invoice. */
  billedHours: number;
  /** Dollars billed that month: TimeEntry.amount plus Expense.amount for
   *  rows on the same sent/partial/paid client invoices (bucketed by the
   *  expense date). Includes expenses because collectedAmount sums every
   *  InvoicePayment, which pays expenses too. */
  billedAmount: number;
  /** Payments received during the month (all invoices). */
  collectedAmount: number;
  /** billedHours / workedHours — billing realization. 0 when nothing worked. */
  billedPctOfWorked: number;
  /** collectedAmount / billedAmount — collection realization. 0 when nothing billed. */
  collectedPctOfBilled: number;
};

/**
 * Trailing 3 viewer-tz calendar months (oldest first, current month
 * last). Worked = billable hours; billed = the subset rolled into a
 * client invoice that has gone out (sent / partial / paid) — NOT
 * draft or approved invoices nobody has received yet, and NOT
 * internal records (which close out WIP without billing anyone);
 * collected = InvoicePayment sums by payment date.
 *
 * Collections are bucketed by when the payment LANDED, not when the
 * underlying hours were worked — standard cash-basis realization,
 * so a strong collections month can exceed 100%.
 */
export async function getRealizationReport(tz: string): Promise<RealizationMonth[]> {
  const monthsBack = [2, 1, 0];

  const months = await Promise.all(
    monthsBack.map(async (back) => {
      const start = startOfMonthInTz(tz, back);
      const end = startOfMonthInTz(tz, back - 1); // exclusive

      const [workedAgg, billedAgg, billedExpenseAgg, collectedAgg] = await Promise.all([
        prisma.timeEntry.aggregate({
          where: { billable: true, date: { gte: start, lt: end } },
          _sum: { hours: true },
        }),
        prisma.timeEntry.aggregate({
          where: {
            billable: true,
            invoiceId: { not: null },
            invoice: {
              kind: "client",
              status: { in: [...BILLED_STATUSES] },
            },
            date: { gte: start, lt: end },
          },
          _sum: { hours: true, amount: true },
        }),
        prisma.expense.aggregate({
          where: {
            invoiceId: { not: null },
            invoice: {
              kind: "client",
              status: { in: [...BILLED_STATUSES] },
            },
            date: { gte: start, lt: end },
          },
          _sum: { amount: true },
        }),
        prisma.invoicePayment.aggregate({
          where: { date: { gte: start, lt: end } },
          _sum: { amount: true },
        }),
      ]);

      const workedHours = workedAgg._sum.hours ?? 0;
      const billedHours = billedAgg._sum.hours ?? 0;
      const billedAmount = roundMoney(
        (billedAgg._sum.amount ?? new Prisma.Decimal(0)).plus(
          billedExpenseAgg._sum.amount ?? new Prisma.Decimal(0),
        ),
      ).toNumber();
      const collectedAmount = collectedAgg._sum.amount?.toNumber() ?? 0;

      return {
        key: dateOnlyKey(start).slice(0, 7),
        label: start.toLocaleString("en-US", {
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        }),
        workedHours,
        billedHours,
        billedAmount,
        collectedAmount,
        billedPctOfWorked: workedHours > 0 ? (billedHours / workedHours) * 100 : 0,
        collectedPctOfBilled: billedAmount > 0 ? (collectedAmount / billedAmount) * 100 : 0,
      };
    }),
  );

  return months;
}
