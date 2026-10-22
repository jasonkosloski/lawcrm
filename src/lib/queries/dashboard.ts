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
 * tomorrow's agenda and misbucket tasks. Two value kinds (ADR-012):
 *
 *  - Date-only columns (TimeEntry.date, Task/Deadline.dueDate, all-day
 *    event bounds, followUpAt's day) are UTC-midnight calendar dates.
 *    The viewer's day key (`todayKey(tz)`) is matched with
 *    `dateOnlyRange` / `dateOnlyKey` / `daysUntilDateOnly` - no zone is
 *    ever applied to the stored value.
 *
 *  - Real instants (timed CalendarEvent.startTime) get true UTC bounds
 *    of the user's local day via `instantInTz`.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { formatPhone } from "@/lib/format-phone";
import { getCurrentUserId } from "@/lib/current-user";
import { getFirmGoals } from "@/lib/firm";
import { currentUserHasPermission } from "@/lib/permission-check";
import {
  activityMoneyFilters,
  resolveActivityMoneyAccess,
} from "@/lib/activity-money-filters";
import { canViewEventDetails } from "@/lib/calendar-visibility";
import { filterAccessibleLeadIds } from "@/lib/lead-access";
import { visibleEmailThreadWhere } from "@/lib/email-visibility";
import {
  filterAccessibleMatterIds,
  matterAccessWhere,
  optionalRecordAccessClause,
} from "@/lib/matter-access";
import { TASK_CLOSED_STATUSES } from "@/lib/constants/task-status";
import { TASK_PRIORITIES } from "@/lib/constants/priority";
import {
  addDaysToKey,
  dateOnlyKey,
  dateOnlyRange,
  daysUntilDateOnly,
  formatRelative,
  instantInTz,
  parseDateOnly,
  todayKey,
} from "@/lib/format-date";

/** Split a `YYYY-MM-DD` day key into [year, month, day]. */
const keyParts = (key: string): [number, number, number] =>
  key.split("-").map(Number) as [number, number, number];

/** First day of the viewer's current month, as a date-only value. */
const startOfMonthDateOnly = (tz: string): Date => {
  const [y, m] = keyParts(todayKey(tz));
  return parseDateOnly(
    `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`
  )!;
};

/** Shape consumed by the KPI tile grid. */
export type DashboardKpis = {
  openMatters: number;
  openMattersChange: string;
  unreadEmail: number;
  /** Starred AND unread threads in the viewer's own mailbox. */
  flaggedEmail: number;
  /** The VIEWER's own logged hours for their calendar day. */
  hoursToday: number;
  hoursGoal: number;
  /** Firm-wide trust total. `null` when the viewer lacks `reports.view`
   *  or `billing.view` (firm-wide financials are "gated separately from the personal
   *  dashboard") - the page omits the tile. */
  trustBalance: number | null;
  trustMatterCount: number | null;
};

export async function getDashboardKpis(tz: string): Promise<DashboardKpis> {
  const userId = await getCurrentUserId();
  // Firm-wide trust needs BOTH the firm-financials key and the
  // billing/trust ledger view key.
  const [canViewReports, canViewBilling] = await Promise.all([
    currentUserHasPermission("reports.view"),
    currentUserHasPermission("billing.view"),
  ]);
  const canViewFinancials = canViewReports && canViewBilling;
  const today = todayKey(tz);
  // Matter wall: the matter COUNT tiles only count matters the viewer
  // can see. The firm-wide trust total below stays an aggregate (it is
  // already gated on reports.view + billing.view, like /reports).
  const matterAccess = await matterAccessWhere(userId);
  const [openMatters, mattersThisWeek, unreadEmail, flaggedEmail, hoursAgg, trustAgg, goals] =
    await Promise.all([
      prisma.matter.count({
        where: {
          ...matterAccess,
          isArchived: false,
          stage: { isTerminal: false },
        },
      }),
      prisma.matter.count({
        where: {
          ...matterAccess,
          isArchived: false,
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      }),
      // Email is per-mailbox: count only threads in the VIEWER's own
      // accounts (visibleEmailThreadWhere), matching the Communication
      // tab and the sidebar badge. Archived threads are not "unread in
      // my inbox".
      prisma.emailThread.count({
        where: {
          ...visibleEmailThreadWhere(userId),
          AND: await optionalRecordAccessClause(userId),
          isRead: false,
          isArchived: false,
        },
      }),
      // "Flagged" = starred + unread in the same scope. (The old
      // EmailLabel "urgent" count read a label no code path writes.)
      prisma.emailThread.count({
        where: {
          ...visibleEmailThreadWhere(userId),
          AND: await optionalRecordAccessClause(userId),
          isStarred: true,
          isRead: false,
          isArchived: false,
        },
      }),
      // The VIEWER's own hours for their calendar day: dailyHoursGoal
      // is a per-person target, and the sidebar badge and /time day
      // view are per-user too. TimeEntry.date is date-only (ADR-012).
      // Uses the viewer's day key; the sidebar badge (sidebar.ts) still
      // uses the server-local day until its owner migrates it, so the
      // two can differ on a UTC host in the evening.
      prisma.timeEntry.aggregate({
        where: { userId, date: dateOnlyRange(today, today) },
        _sum: { hours: true },
      }),
      // Firm-wide trust total: skipped entirely without reports.view + billing.view.
      canViewFinancials
        ? prisma.matter.aggregate({
            where: { trustBalance: { gt: 0 } },
            _sum: { trustBalance: true },
            _count: true,
          })
        : Promise.resolve(null),
      // Firm-settable target (settings -> Firm info); was a
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
    // Decimal -> number at the API boundary. Display + KPI math
    // tolerates the precision floor; the Decimal stays canonical
    // in the DB. Same pattern below for invoice totals.
    trustBalance: trustAgg ? (trustAgg._sum.trustBalance?.toNumber() ?? 0) : null,
    trustMatterCount: trustAgg ? trustAgg._count : null,
  };
}

export type AgendaItem = {
  id: string;
  /** "9:00a" for timed events, "All day" for all-day ones. */
  time: string;
  title: string;
  area: string;
  color: string;
};

/** Compact "9:00a" / "3:30p" label, anchored to the user's zone -
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
  const key = todayKey(tz);
  // Timed events are real instants - bound by the true UTC extent of
  // the user's local day [00:00, next 00:00).
  const [y, m, d] = keyParts(key);
  const [ny, nm, nd] = keyParts(addDaysToKey(key, 1));
  const dayStart = instantInTz(y, m, d, 0, 0, tz);
  const nextDayStart = instantInTz(ny, nm, nd, 0, 0, tz);
  // All-day events are date-only (ADR-012): they cover the calendar
  // dates startTime..endTime (inclusive), whatever the viewer's zone.
  // Applying the instant window to them shows tomorrow's all-day
  // event (stored 00:00Z) at "6:00p" and drops today's.
  const allDayDay = dateOnlyRange(key, key);
  // Same inputs queries/calendar.ts feeds the visibility resolver:
  // creator + creator default, attendee user ids, active matter team.
  const events = await prisma.calendarEvent.findMany({
    where: {
      OR: [
        { isAllDay: false, startTime: { gte: dayStart, lt: nextDayStart } },
        {
          isAllDay: true,
          startTime: { lt: allDayDay.lt },
          endTime: { gte: allDayDay.gte },
        },
      ],
    },
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

  // Matter wall: events on matters this viewer can't access stay on
  // the agenda as "Busy" blocks (canViewEventDetails.matterAccessible).
  const accessibleMatters = await filterAccessibleMatterIds(
    viewerId,
    events.flatMap((e) => (e.matter ? [e.matter.id] : []))
  );
  // Lead wall (ADR-049): events on hidden leads are Busy as well.
  const accessibleLeads = await filterAccessibleLeadIds(
    viewerId,
    events.flatMap((e) => (e.leadId ? [e.leadId] : []))
  );

  // All-day rows lead the agenda, then timed events in start order
  // (Array.sort is stable, so the DB's startTime order is kept).
  const ordered = [...events].sort(
    (a, b) => Number(b.isAllDay) - Number(a.isAllDay)
  );

  return ordered.map((e) => {
    const time = e.isAllDay ? "All day" : formatTime(e.startTime, tz);
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
      matterAccessible: e.matter ? accessibleMatters.has(e.matter.id) : true,
      leadId: e.leadId,
      leadAccessible: e.leadId ? accessibleLeads.has(e.leadId) : true,
    });

    // Busy scrub - identical to the calendar's: the time block stays,
    // title / practice area / color are replaced server-side.
    if (!canSee) {
      return {
        id: e.id,
        time,
        title: "Busy",
        area: "Firm",
        color: "var(--color-ink-3)",
      };
    }

    const pa = e.matter?.practiceArea;
    return {
      id: e.id,
      time,
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
  const [moneyAccess, canViewFirmActivity] = await Promise.all([
    resolveActivityMoneyAccess(),
    currentUserHasPermission("firm.view_activity"),
  ]);
  const viewerId = await getCurrentUserId();
  // Matter + lead walls: matter-linked rows only for accessible
  // matters, lead-linked rows (ActivityLog.leadId) only for visible
  // leads; firm-scope rows stay under their own gate below.
  const activityAccess = await optionalRecordAccessClause(viewerId);
  const entries = await prisma.activityLog.findMany({
    where: {
      // Sign-in/password audit rows and firm-settings changes (practice
      // area / stage / calendar-default edits, reorder clicks) are
      // governance, not work - they live on /settings/activity (+
      // /settings/security for auth) only.
      type: { notIn: ["auth", "settings"] },
      AND: [
        ...activityAccess,
        // Settlement / trust / expense rows carry amounts — the same
        // rule as the Timeline and Settings → Activity.
        ...activityMoneyFilters(moneyAccess),
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
  const userId = await getCurrentUserId();
  // `followUpAt` stores the END of its calendar day (the snooze actions
  // write 23:59:59.999 of the picked date), so the day it belongs to
  // is its date key. Due = day key <= the viewer's today, i.e. before
  // the start of tomorrow; overdue = day key strictly before today.
  // Comparing the raw instant to `Date.now()` would flag a follow-up
  // "overdue" in the evening of its own day for a viewer west of UTC.
  const today = todayKey(tz);
  const dueBefore = dateOnlyRange(today, today).lt;
  // Matter wall: a follow-up whose thread is filed to a matter the
  // viewer can't access is left off the card (no name leak, and the
  // thread itself 404s for them).
  const emailMatterAccess = await optionalRecordAccessClause(userId);
  const hiddenMatterWhere = await matterAccessWhere(userId);
  const messengerMatterAccess =
    Object.keys(hiddenMatterWhere).length === 0
      ? []
      : [
          {
            OR: [
              { defaultMatterId: null },
              { defaultMatter: hiddenMatterWhere },
            ],
          },
        ];
  const [emails, messages] = await Promise.all([
    prisma.emailThread.findMany({
      // Viewer's own mailbox only (EmailThread -> EmailAccount.userId),
      // in the where so `take` can't be eaten by other users' threads.
      where: {
        followUpAt: { lt: dueBefore },
        isArchived: false,
        ...visibleEmailThreadWhere(userId),
        AND: emailMatterAccess,
      },
      orderBy: { followUpAt: "asc" },
      take: 50,
      include: {
        matter: { select: { name: true, color: true } },
      },
    }),
    prisma.messengerThread.findMany({
      where: {
        followUpAt: { lt: dueBefore },
        isArchived: false,
        AND: messengerMatterAccess,
      },
      orderBy: { followUpAt: "asc" },
      take: 50,
      include: {
        defaultMatter: { select: { name: true, color: true } },
        contact: { select: { name: true } },
      },
    }),
  ]);

  const isOverdue = (at: Date): boolean => dateOnlyKey(at) < today;
  const items: FollowUpItem[] = [
    ...emails.map((t) => ({
      id: t.id,
      kind: "email" as const,
      label: t.subject,
      followUpAt: t.followUpAt!,
      isOverdue: isOverdue(t.followUpAt!),
      matterName: t.matter?.name ?? null,
      matterColor: t.matter?.color ?? null,
    })),
    ...messages.map((t) => ({
      id: t.id,
      kind: "messenger" as const,
      label:
        t.contact?.name ??
        (formatPhone(t.contactPhone) || "Unknown number"),
      followUpAt: t.followUpAt!,
      isOverdue: isOverdue(t.followUpAt!),
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

export type DeadlineItem = {
  id: string;
  title: string;
  /** Date-only due date (UTC midnight, ADR-012). */
  dueDate: Date;
  /** Whole days from the viewer's today: 0 = today, NEGATIVE = overdue. */
  days: number;
  kind: "critical" | "auto_rule" | "manual";
  matterId: string;
  matterName: string;
};

/** Rows loaded for the upcoming window, and for the overdue backlog. */
const DEADLINES_UPCOMING_LIMIT = 20;
const DEADLINES_OVERDUE_LIMIT = 10;

export type DeadlinesCard = {
  /** Overdue rows first (most overdue first), then the upcoming window. */
  items: DeadlineItem[];
  /** Open overdue deadlines not shown because of the overdue cap. */
  overdueHidden: number;
};

/**
 * Open deadlines for the "Deadlines this week" card. The upcoming
 * window (today .. today + withinDays) and the overdue backlog are
 * queried SEPARATELY so a pile of stale open deadlines can never push
 * the ones due this week off the card: the window always gets its own
 * budget, and overdue rows are capped (the most recent lapses show;
 * the rest are reported in `overdueHidden`).
 */
export async function getUpcomingDeadlines(
  tz: string,
  withinDays = 7
): Promise<DeadlinesCard> {
  // Due dates are date-only (UTC midnight, ADR-012): the window starts
  // at the viewer's today and ends at the end of (today + withinDays);
  // the countdown is calendar days against the viewer's today key.
  // Archived matters are skipped (the notification sweep skips them too).
  const today = todayKey(tz);
  const lastKey = addDaysToKey(today, withinDays);
  const windowBounds = dateOnlyRange(today, lastKey);
  // Matter wall: only deadlines on matters the viewer can access.
  const wallMatter = await matterAccessWhere(await getCurrentUserId());
  const base = {
    status: "open",
    matter: { ...wallMatter, isArchived: false },
  };
  const select = {
    id: true,
    title: true,
    dueDate: true,
    kind: true,
    matterId: true,
    matter: { select: { name: true } },
  } as const;

  const [upcoming, overdueRecent, overdueTotal] = await Promise.all([
    prisma.deadline.findMany({
      where: { ...base, dueDate: windowBounds },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      take: DEADLINES_UPCOMING_LIMIT,
      select,
    }),
    prisma.deadline.findMany({
      where: { ...base, dueDate: { lt: windowBounds.gte } },
      orderBy: [{ dueDate: "desc" }, { createdAt: "asc" }],
      take: DEADLINES_OVERDUE_LIMIT,
      select,
    }),
    prisma.deadline.count({
      where: { ...base, dueDate: { lt: windowBounds.gte } },
    }),
  ]);

  const toItem = (dl: (typeof upcoming)[number]): DeadlineItem => ({
    id: dl.id,
    title: dl.title,
    dueDate: dl.dueDate,
    days: daysUntilDateOnly(dl.dueDate, tz),
    kind: (dl.kind as DeadlineItem["kind"]) ?? "manual",
    matterId: dl.matterId,
    matterName: dl.matter.name,
  });

  return {
    // overdueRecent is newest-first; flip so the most overdue leads.
    items: [...overdueRecent.reverse(), ...upcoming].map(toItem),
    overdueHidden: Math.max(0, overdueTotal - overdueRecent.length),
  };
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
  /** Context line: the matter's name, "Intake · {lead}" for an intake
   *  task, null for a firm-wide task. */
  matterName: string | null;
  /** Set for an intake task (Task.leadId) — links to the lead's tab. */
  leadId: string | null;
};

/** Tasks bucketed by due date for the dashboard card. */
export type MyTasksGrouped = {
  overdue: MyTaskItem[];
  today: MyTaskItem[];
  thisWeek: MyTaskItem[];
  later: MyTaskItem[];
  noDueDate: MyTaskItem[];
  /** Every open task the user owns (accurate even when capped below). */
  total: number;
  /** Exact count of open tasks due before the viewer's today (the
   *  list above is capped per bucket; this is not). */
  overdueCount: number;
  /** Open tasks not rendered because of the row caps. */
  hidden: number;
};

/** Rows loaded for the tasks card, and rows rendered per bucket. */
const MY_TASKS_FETCH_LIMIT = 200;
export const MY_TASKS_BUCKET_LIMIT = 25;

/** Rank for sorting: higher = more urgent. Unknown values rank as "normal". */
const priorityRank = (priority: string): number => {
  const idx = (TASK_PRIORITIES as readonly string[]).indexOf(priority);
  return idx === -1 ? TASK_PRIORITIES.indexOf("normal") : idx;
};

/**
 * Outstanding (non-closed) tasks owned by the current user, grouped by
 * due-date bucket. Sorted within each bucket by due date asc, then
 * priority (urgent first), then creation order. Used by the "Your
 * tasks" dashboard card.
 */
export async function getMyOpenTasks(tz: string): Promise<MyTasksGrouped> {
  const userId = await getCurrentUserId();
  // Matter wall: firm-wide tasks (no matter) stay; matter tasks need
  // access to the matter.
  const where = {
    ownerId: userId,
    status: { notIn: [...TASK_CLOSED_STATUSES] },
    AND: await optionalRecordAccessClause(userId),
  };

  const [tasks, total, overdueCount] = await Promise.all([
    prisma.task.findMany({
      where,
      // Priority is a string column (alphabetical order would put
      // "high" below "low"), so it is ranked in JS below.
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      take: MY_TASKS_FETCH_LIMIT,
      select: {
        id: true,
        title: true,
        priority: true,
        dueDate: true,
        createdAt: true,
        matterId: true,
        matter: { select: { name: true } },
        leadId: true,
        lead: { select: { name: true } },
      },
    }),
    prisma.task.count({ where }),
    prisma.task.count({
      where: {
        ...where,
        dueDate: { lt: dateOnlyRange(todayKey(tz), todayKey(tz)).gte },
      },
    }),
  ]);

  // dueDate asc (nulls last), then most urgent first, then oldest.
  const sorted = [...tasks].sort((a, b) => {
    const ad = a.dueDate ? a.dueDate.getTime() : Infinity;
    const bd = b.dueDate ? b.dueDate.getTime() : Infinity;
    if (ad !== bd) return ad < bd ? -1 : 1;
    const pr = priorityRank(b.priority) - priorityRank(a.priority);
    if (pr !== 0) return pr;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  const grouped: MyTasksGrouped = {
    overdue: [],
    today: [],
    thisWeek: [],
    later: [],
    noDueDate: [],
    total,
    overdueCount,
    hidden: 0,
  };

  for (const t of sorted) {
    const item: MyTaskItem = {
      id: t.id,
      title: t.title,
      priority: t.priority,
      dueDate: t.dueDate,
      // Calendar days from the viewer's today to the date-only due date.
      daysUntilDue: t.dueDate ? daysUntilDateOnly(t.dueDate, tz) : null,
      matterId: t.matterId,
      // Intake tasks carry their lead as the context line.
      matterName:
        t.matter?.name ?? (t.lead ? `Intake · ${t.lead.name}` : null),
      leadId: t.leadId,
    };

    const bucket =
      item.daysUntilDue === null
        ? grouped.noDueDate
        : item.daysUntilDue < 0
          ? grouped.overdue
          : item.daysUntilDue === 0
            ? grouped.today
            : item.daysUntilDue <= 7
              ? grouped.thisWeek
              : grouped.later;
    if (bucket.length < MY_TASKS_BUCKET_LIMIT) bucket.push(item);
  }

  const shown =
    grouped.overdue.length +
    grouped.today.length +
    grouped.thisWeek.length +
    grouped.later.length +
    grouped.noDueDate.length;
  grouped.hidden = Math.max(0, total - shown);

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
      where: { date: { gte: startOfMonthDateOnly(tz) }, billable: true },
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
    // Firm-settable target - was a hardcoded 200.
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
