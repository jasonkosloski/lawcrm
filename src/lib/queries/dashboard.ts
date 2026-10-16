/**
 * Dashboard Queries
 *
 * Server-only data access for the Today / Dashboard page. Each function
 * returns plain, serializable shapes ready for the view layer so that
 * query details don't leak into components.
 *
 * "Today" is the USER's calendar day, not the server's: every query
 * takes the viewer's IANA `tz`. On a UTC production box a Denver user
 * loading the dashboard at 7pm local (1am UTC) would otherwise see
 * tomorrow's agenda and misbucket tasks — the same bug class the
 * calendar fixed via `parseCalendarParams`. Two boundary flavors:
 *
 *  - Date-only columns (TimeEntry.date, Task/Deadline.dueDate,
 *    followUpAt's end-of-day) are stored at *server-local* midnight
 *    of their calendar day (see `parseLocalDate`). Bounds for those
 *    = server-local midnight of the user's current calendar DATE —
 *    the date-key round-trip `parseCalendarParams` uses.
 *
 *  - Real instants (CalendarEvent.startTime) get true UTC bounds of
 *    the user's local day via `instantInTz`.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { getFirmGoals } from "@/lib/firm";
import { currentUserHasPermission } from "@/lib/permission-check";
import { canViewEventDetails } from "@/lib/calendar-visibility";
import { dateKeyInTz, formatRelative, instantInTz } from "@/lib/format-date";

/** The viewer's current calendar date as [year, month, day] in their zone. */
const todayYmdInTz = (tz: string): [number, number, number] =>
  dateKeyInTz(new Date(), tz).split("-").map(Number) as [
    number,
    number,
    number,
  ];

/** Server-local midnight of the user's current calendar date — the
 *  lower bound for date-only columns (which store server-local
 *  midnight of their day). */
const startOfTodayInTz = (tz: string): Date => {
  const [y, m, d] = todayYmdInTz(tz);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
};

/** Server-local 23:59:59.999 of the user's current calendar date. */
const endOfTodayInTz = (tz: string): Date => {
  const [y, m, d] = todayYmdInTz(tz);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
};

/** Server-local midnight of the 1st of the user's current month. */
const startOfMonthInTz = (tz: string): Date => {
  const [y, m] = todayYmdInTz(tz);
  return new Date(y, m - 1, 1, 0, 0, 0, 0);
};

/** Shape consumed by the KPI tile grid. */
export type DashboardKpis = {
  openMatters: number;
  openMattersChange: string;
  unreadEmail: number;
  flaggedEmail: number;
  hoursToday: number;
  hoursGoal: number;
  /** Firm-wide trust total. `null` when the viewer lacks `reports.view`
   *  (firm-wide financials are "gated separately from the personal
   *  dashboard") — the page omits the tile. */
  trustBalance: number | null;
  trustMatterCount: number | null;
};

export async function getDashboardKpis(tz: string): Promise<DashboardKpis> {
  const userId = await getCurrentUserId();
  const canViewFinancials = await currentUserHasPermission("reports.view");
  const [openMatters, mattersThisWeek, unreadEmail, flaggedEmail, hoursAgg, trustAgg, goals] =
    await Promise.all([
      prisma.matter.count({
        where: { isArchived: false, stage: { isTerminal: false } },
      }),
      prisma.matter.count({
        where: {
          isArchived: false,
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      }),
      // Email is per-mailbox: count only threads in the VIEWER's own
      // accounts (EmailThread -> EmailAccount.userId), matching the
      // Communication tab's counts. Another user's unread/urgent mail
      // must not move this viewer's tile.
      prisma.emailThread.count({
        where: { isRead: false, account: { userId } },
      }),
      prisma.emailLabel.count({
        where: { label: "urgent", thread: { account: { userId } } },
      }),
      prisma.timeEntry.aggregate({
        where: { date: { gte: startOfTodayInTz(tz), lte: endOfTodayInTz(tz) } },
        _sum: { hours: true },
      }),
      // Firm-wide trust total: skipped entirely without reports.view.
      canViewFinancials
        ? prisma.matter.aggregate({
            where: { trustBalance: { gt: 0 } },
            _sum: { trustBalance: true },
            _count: true,
          })
        : Promise.resolve(null),
      // Firm-settable target (settings → Firm info); was a
      // hardcoded 6.0 before Firm.dailyHoursGoal existed.
      getFirmGoals(),
    ]);

  return {
    openMatters,
    openMattersChange:
      mattersThisWeek > 0 ? `+${mattersThisWeek} this week` : "no change this week",
    unreadEmail,
    flaggedEmail,
    hoursToday: hoursAgg._sum.hours ?? 0,
    hoursGoal: goals.dailyHoursGoal,
    // Decimal → number at the API boundary. Display + KPI math
    // tolerates the precision floor; the Decimal stays canonical
    // in the DB. Same pattern below for invoice totals.
    trustBalance: trustAgg ? (trustAgg._sum.trustBalance?.toNumber() ?? 0) : null,
    trustMatterCount: trustAgg ? trustAgg._count : null,
  };
}

export type AgendaItem = {
  id: string;
  time: string;
  title: string;
  area: string;
  color: string;
};

/** Compact "9:00a" / "3:30p" label, anchored to the user's zone —
 *  `getHours()` would read the server's wall clock (UTC in prod)
 *  and label a 9am Denver hearing "3:00p". */
const formatTime = (d: Date, tz: string): string => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const h = get("hour") % 24; // some ICU builds emit 24 for midnight
  const m = get("minute");
  const suffix = h >= 12 ? "p" : "a";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${m.toString().padStart(2, "0")}${suffix}`;
};

export async function getTodayAgenda(tz: string): Promise<AgendaItem[]> {
  const viewerId = await getCurrentUserId();
  // Real instants — bound by the true UTC extent of the user's
  // local day (not the date-key round-trip used for date-only
  // columns above).
  const [y, m, d] = todayYmdInTz(tz);
  const dayStart = instantInTz(y, m, d, 0, 0, tz);
  const dayEnd = instantInTz(y, m, d, 23, 59, tz);
  // Same inputs queries/calendar.ts feeds the visibility resolver:
  // creator + creator default, attendee user ids, active matter team.
  const events = await prisma.calendarEvent.findMany({
    where: { startTime: { gte: dayStart, lte: dayEnd } },
    orderBy: { startTime: "asc" },
    include: {
      matter: {
        select: {
          id: true,
          practiceArea: { select: { name: true, color: true } },
          teamMembers: {
            where: { removedAt: null },
            select: { userId: true },
          },
        },
      },
      createdBy: { select: { defaultEventVisibility: true } },
      attendees: { select: { userId: true } },
    },
  });

  return events.map((e) => {
    const canSee = canViewEventDetails({
      viewerId,
      createdById: e.createdById,
      eventVisibility: e.visibility,
      creatorDefaultEventVisibility:
        e.createdBy?.defaultEventVisibility ?? null,
      matterId: e.matter?.id ?? null,
      attendeeUserIds: e.attendees
        .map((a) => a.userId)
        .filter((id): id is string => !!id),
      matterTeamUserIds: e.matter?.teamMembers.map((t) => t.userId) ?? [],
    });

    // Busy scrub — identical to the calendar's: the time block stays,
    // title / practice area / color are replaced server-side.
    if (!canSee) {
      return {
        id: e.id,
        time: formatTime(e.startTime, tz),
        title: "Busy",
        area: "Firm",
        color: "var(--color-ink-3)",
      };
    }

    const pa = e.matter?.practiceArea;
    return {
      id: e.id,
      time: formatTime(e.startTime, tz),
      title: e.title,
      area: pa?.name ?? "Firm",
      color: pa?.color ?? "var(--color-ink-3)",
    };
  });
}

export type ActivityItem = {
  id: string;
  iconName: string;
  title: string;
  detail: string;
  time: string;
  source: string;
};

// Use the centralized formatter so the dashboard activity feed
// reads identically to every other relative-time surface across
// the app (matter Timeline, settings/activity, etc.). `tz` only
// matters for the >30-day fallback, which renders a calendar date.
export async function getRecentActivity(
  tz: string,
  limit = 5
): Promise<ActivityItem[]> {
  const [canViewSettlements, canViewExpenses, canViewFirmActivity] =
    await Promise.all([
      currentUserHasPermission("matters.settlement.view"),
      currentUserHasPermission("matters.expense.view"),
      currentUserHasPermission("firm.view_activity"),
    ]);
  const entries = await prisma.activityLog.findMany({
    where: {
      // Sign-in/password audit rows and firm-settings changes (practice
      // area / stage / calendar-default edits, reorder clicks) are
      // governance, not work — they live on /settings/activity (+
      // /settings/security for auth) only.
      type: { notIn: ["auth", "settings"] },
      AND: [
        // Settlement rows carry gross amounts + lienholders: same key
        // that gates the settlement UI.
        ...(canViewSettlements ? [] : [{ type: { not: "settlement" } }]),
        // Expense rows (type "filing", "Expense logged · $X · desc")
        // carry amounts + descriptions: gated by matters.expense.view.
        ...(canViewExpenses
          ? []
          : [
              {
                NOT: {
                  matterId: { not: null },
                  title: { startsWith: "Expense " },
                },
              },
            ]),
        // Firm-scope rows (matterId null: role grants, conflict-check
        // overrides, lead declines, rule edits) are the governance
        // feed /settings/activity gates on firm.view_activity.
        ...(canViewFirmActivity ? [] : [{ matterId: { not: null } }]),
      ],
    },
    orderBy: { timestamp: "desc" },
    take: limit,
  });
  return entries.map((e) => ({
    id: e.id,
    iconName: e.icon ?? "circle",
    title: e.title,
    detail: e.detail ?? "",
    time: formatRelative(e.timestamp, tz),
    source: e.source ?? "",
  }));
}

/** Email + messenger threads with a follow-up date today or earlier
 *  (or unset overdue followUps from prior days). Surfaced on the
 *  dashboard "Follow up today" card so the user sees the queue
 *  before the next email lands. */
export type FollowUpItem = {
  id: string;
  kind: "email" | "messenger";
  /** Subject line for email, contact name (or pretty phone) for messenger. */
  label: string;
  followUpAt: Date;
  isOverdue: boolean;
  matterName: string | null;
  matterColor: string | null;
};

export async function getFollowUpsDueToday(tz: string): Promise<FollowUpItem[]> {
  const end = endOfTodayInTz(tz);
  const userId = await getCurrentUserId();
  const [emails, messages] = await Promise.all([
    prisma.emailThread.findMany({
      // Viewer's own mailbox only (EmailThread -> EmailAccount.userId),
      // in the where so `take` can't be eaten by other users' threads.
      where: {
        followUpAt: { lte: end },
        isArchived: false,
        account: { userId },
      },
      orderBy: { followUpAt: "asc" },
      take: 50,
      include: {
        matter: { select: { name: true, color: true } },
      },
    }),
    prisma.messengerThread.findMany({
      where: { followUpAt: { lte: end }, isArchived: false },
      orderBy: { followUpAt: "asc" },
      take: 50,
      include: {
        defaultMatter: { select: { name: true, color: true } },
        contact: { select: { name: true } },
      },
    }),
  ]);

  const now = Date.now();
  const items: FollowUpItem[] = [
    ...emails.map((t) => ({
      id: t.id,
      kind: "email" as const,
      label: t.subject,
      followUpAt: t.followUpAt!,
      isOverdue: t.followUpAt!.getTime() < now,
      matterName: t.matter?.name ?? null,
      matterColor: t.matter?.color ?? null,
    })),
    ...messages.map((t) => ({
      id: t.id,
      kind: "messenger" as const,
      label:
        t.contact?.name ??
        prettyPhoneForFollowUp(t.contactPhone) ??
        "Unknown number",
      followUpAt: t.followUpAt!,
      isOverdue: t.followUpAt!.getTime() < now,
      matterName: t.defaultMatter?.name ?? null,
      matterColor: t.defaultMatter?.color ?? null,
    })),
  ];

  // Merge + sort: overdue first, then by date asc.
  return items.sort((a, b) => {
    if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
    return a.followUpAt.getTime() - b.followUpAt.getTime();
  });
}

function prettyPhoneForFollowUp(p: string): string {
  const digits = p.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return p;
}

export type DeadlineItem = {
  id: string;
  title: string;
  days: number;
  kind: "critical" | "auto_rule" | "manual";
};

export async function getUpcomingDeadlines(
  tz: string,
  withinDays = 7
): Promise<DeadlineItem[]> {
  // Due dates are date-only (server-local midnight), so the window
  // end is server-local 23:59 of (user's today + withinDays) — the
  // Date constructor rolls the day overflow into the right month.
  const [y, m, d] = todayYmdInTz(tz);
  const end = new Date(y, m - 1, d + withinDays, 23, 59, 59, 999);

  const deadlines = await prisma.deadline.findMany({
    where: { status: "open", dueDate: { lte: end } },
    orderBy: { dueDate: "asc" },
  });

  // Whole-day countdown against the user's today. Round (not
  // ceil/floor) so a DST-shortened or -lengthened day still lands
  // on the integer, and legacy rows stored at UTC midnight (before
  // the parseLocalDate fix) don't off-by-one.
  const todayMs = startOfTodayInTz(tz).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  return deadlines.map((d) => ({
    id: d.id,
    title: d.title,
    days: Math.max(0, Math.round((d.dueDate.getTime() - todayMs) / dayMs)),
    kind: (d.kind as DeadlineItem["kind"]) ?? "manual",
  }));
}

/** A single open task assigned to the current user, shaped for the dashboard. */
export type MyTaskItem = {
  id: string;
  title: string;
  priority: string;
  dueDate: Date | null;
  /** Negative when overdue, 0 today, positive when in the future, null if no due date. */
  daysUntilDue: number | null;
  matterId: string | null;
  matterName: string | null;
};

/** Tasks bucketed by due date for the dashboard card. */
export type MyTasksGrouped = {
  overdue: MyTaskItem[];
  today: MyTaskItem[];
  thisWeek: MyTaskItem[];
  later: MyTaskItem[];
  noDueDate: MyTaskItem[];
  total: number;
};

/**
 * Outstanding (non-done, non-cancelled) tasks owned by the current user,
 * grouped by due-date bucket. Sorted within each bucket by due date asc,
 * then priority. Used by the "Your tasks" dashboard card.
 */
export async function getMyOpenTasks(tz: string): Promise<MyTasksGrouped> {
  const userId = await getCurrentUserId();

  const tasks = await prisma.task.findMany({
    where: {
      ownerId: userId,
      status: { notIn: ["done", "cancelled"] },
    },
    orderBy: [{ dueDate: "asc" }, { priority: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      title: true,
      priority: true,
      dueDate: true,
      matterId: true,
      matter: { select: { name: true } },
    },
  });

  const todayMs = startOfTodayInTz(tz).getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  const grouped: MyTasksGrouped = {
    overdue: [],
    today: [],
    thisWeek: [],
    later: [],
    noDueDate: [],
    total: tasks.length,
  };

  for (const t of tasks) {
    const item: MyTaskItem = {
      id: t.id,
      title: t.title,
      priority: t.priority,
      dueDate: t.dueDate,
      // Round (not floor): both ends sit at server-local midnight so
      // the diff is a whole number of days except across a DST jump
      // (23h/25h day), where floor would misbucket "tomorrow" as
      // "today". setHours normalizes legacy UTC-midnight rows.
      daysUntilDue: t.dueDate
        ? Math.round(
            (new Date(t.dueDate).setHours(0, 0, 0, 0) - todayMs) / dayMs
          )
        : null,
      matterId: t.matterId,
      matterName: t.matter?.name ?? null,
    };

    if (item.daysUntilDue === null) grouped.noDueDate.push(item);
    else if (item.daysUntilDue < 0) grouped.overdue.push(item);
    else if (item.daysUntilDue === 0) grouped.today.push(item);
    else if (item.daysUntilDue <= 7) grouped.thisWeek.push(item);
    else grouped.later.push(item);
  }

  return grouped;
}

export type FirmPulse = {
  billableMtd: number;
  billableGoal: number;
  collectionRate: number;
  arOutstanding: number;
};

// Invoice filters mirror /reports (queries/reports.ts getArAgingReport):
// receivables are client invoices in sent / partial. Void, draft /
// approved (not yet sent) and internal records (born "paid") are never
// A/R. The collection rate is collected / billed over client invoices
// that have actually gone out: sent, partial and paid.
const AR_OPEN_STATUSES = ["sent", "partial"];
const BILLED_STATUSES = ["sent", "partial", "paid"];

/** Firm-wide pulse. Returns `null` for viewers without `reports.view`
 *  (billable hours, A/R and collection rate are firm-wide financials,
 *  gated like /reports) without running the aggregates. */
export async function getFirmPulse(tz: string): Promise<FirmPulse | null> {
  if (!(await currentUserHasPermission("reports.view"))) return null;

  const [mtdAgg, openInvoices, billedAgg, goals] = await Promise.all([
    prisma.timeEntry.aggregate({
      where: { date: { gte: startOfMonthInTz(tz) }, billable: true },
      _sum: { hours: true },
    }),
    prisma.invoice.findMany({
      where: { kind: "client", status: { in: AR_OPEN_STATUSES } },
      select: { totalAmount: true, paidAmount: true },
    }),
    prisma.invoice.aggregate({
      where: { kind: "client", status: { in: BILLED_STATUSES } },
      _sum: { totalAmount: true, paidAmount: true },
    }),
    // Firm-settable target — was a hardcoded 200.
    getFirmGoals(),
  ]);

  // A/R: per-invoice outstanding, skipping fully-paid-but-unflipped
  // rows exactly like the aging report. Decimal until the boundary.
  let arOutstanding = new Prisma.Decimal(0);
  for (const inv of openInvoices) {
    const outstanding = inv.totalAmount.minus(inv.paidAmount);
    if (outstanding.gt(0)) arOutstanding = arOutstanding.plus(outstanding);
  }

  const billed = billedAgg._sum.totalAmount ?? new Prisma.Decimal(0);
  const collected = billedAgg._sum.paidAmount ?? new Prisma.Decimal(0);
  const collectionRate = billed.gt(0)
    ? collected.div(billed).mul(100).toNumber()
    : 0;

  return {
    billableMtd: mtdAgg._sum.hours ?? 0,
    billableGoal: goals.monthlyBillableGoal,
    collectionRate,
    arOutstanding: arOutstanding.toNumber(),
  };
}
