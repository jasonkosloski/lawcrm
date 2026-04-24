/**
 * Dashboard Queries
 *
 * Server-only data access for the Today / Dashboard page. Each function
 * returns plain, serializable shapes ready for the view layer so that
 * query details don't leak into components.
 *
 * "Today" is computed from `new Date()` — queries assume the server clock
 * and seeded fixture timestamps are aligned.
 */

import { prisma } from "@/lib/prisma";

const startOfToday = (): Date => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfToday = (): Date => {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
};

const startOfMonth = (): Date => {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
};

/** Shape consumed by the KPI tile grid. */
export type DashboardKpis = {
  openMatters: number;
  openMattersChange: string;
  unreadEmail: number;
  flaggedEmail: number;
  hoursToday: number;
  hoursGoal: number;
  trustBalance: number;
  trustMatterCount: number;
};

export async function getDashboardKpis(): Promise<DashboardKpis> {
  const [openMatters, mattersThisWeek, unreadEmail, flaggedEmail, hoursAgg, trustAgg] =
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
      prisma.emailThread.count({ where: { isRead: false } }),
      prisma.emailLabel.count({ where: { label: "urgent" } }),
      prisma.timeEntry.aggregate({
        where: { date: { gte: startOfToday(), lte: endOfToday() } },
        _sum: { hours: true },
      }),
      prisma.matter.aggregate({
        where: { trustBalance: { gt: 0 } },
        _sum: { trustBalance: true },
        _count: true,
      }),
    ]);

  return {
    openMatters,
    openMattersChange:
      mattersThisWeek > 0 ? `+${mattersThisWeek} this week` : "no change this week",
    unreadEmail,
    flaggedEmail,
    hoursToday: hoursAgg._sum.hours ?? 0,
    hoursGoal: 6.0,
    trustBalance: trustAgg._sum.trustBalance ?? 0,
    trustMatterCount: trustAgg._count,
  };
}

export type AgendaItem = {
  id: string;
  time: string;
  title: string;
  area: string;
  color: string;
};

const formatTime = (d: Date): string => {
  const h = d.getHours();
  const m = d.getMinutes();
  const suffix = h >= 12 ? "p" : "a";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}:00${suffix}` : `${hour12}:${m.toString().padStart(2, "0")}${suffix}`;
};

export async function getTodayAgenda(): Promise<AgendaItem[]> {
  const events = await prisma.calendarEvent.findMany({
    where: { startTime: { gte: startOfToday(), lte: endOfToday() } },
    orderBy: { startTime: "asc" },
    include: {
      matter: {
        select: { practiceArea: { select: { name: true, color: true } } },
      },
    },
  });

  return events.map((e) => {
    const pa = e.matter?.practiceArea;
    return {
      id: e.id,
      time: formatTime(e.startTime),
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

const formatRelativeTime = (ts: Date): string => {
  const diffMs = Date.now() - ts.getTime();
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yest.";
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
};

export async function getRecentActivity(limit = 5): Promise<ActivityItem[]> {
  const entries = await prisma.activityLog.findMany({
    orderBy: { timestamp: "desc" },
    take: limit,
  });
  return entries.map((e) => ({
    id: e.id,
    iconName: e.icon ?? "circle",
    title: e.title,
    detail: e.detail ?? "",
    time: formatRelativeTime(e.timestamp),
    source: e.source ?? "",
  }));
}

export type DeadlineItem = {
  id: string;
  title: string;
  days: number;
  kind: "critical" | "auto_rule" | "manual";
};

export async function getUpcomingDeadlines(withinDays = 7): Promise<DeadlineItem[]> {
  const end = new Date();
  end.setDate(end.getDate() + withinDays);
  end.setHours(23, 59, 59, 999);

  const deadlines = await prisma.deadline.findMany({
    where: { status: "open", dueDate: { lte: end } },
    orderBy: { dueDate: "asc" },
  });

  const now = Date.now();
  return deadlines.map((d) => ({
    id: d.id,
    title: d.title,
    days: Math.max(0, Math.ceil((d.dueDate.getTime() - now) / (24 * 60 * 60 * 1000))),
    kind: (d.kind as DeadlineItem["kind"]) ?? "manual",
  }));
}

export type FirmPulse = {
  billableMtd: number;
  billableGoal: number;
  collectionRate: number;
  arOutstanding: number;
};

export async function getFirmPulse(): Promise<FirmPulse> {
  const [mtdAgg, invoiceAgg] = await Promise.all([
    prisma.timeEntry.aggregate({
      where: { date: { gte: startOfMonth() }, billable: true },
      _sum: { hours: true },
    }),
    prisma.invoice.aggregate({
      _sum: { totalAmount: true, paidAmount: true },
    }),
  ]);

  const total = invoiceAgg._sum.totalAmount ?? 0;
  const paid = invoiceAgg._sum.paidAmount ?? 0;
  const collectionRate = total > 0 ? (paid / total) * 100 : 0;
  const arOutstanding = Math.max(0, total - paid);

  return {
    billableMtd: mtdAgg._sum.hours ?? 0,
    billableGoal: 200,
    collectionRate,
    arOutstanding,
  };
}
