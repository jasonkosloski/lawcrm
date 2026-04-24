/**
 * Sidebar Queries
 *
 * One aggregate fetch for everything the sidebar displays: the current
 * user, nav badges (open matters, unread email, today's hours, active
 * leads), practice-area counts, and pinned matters. Runs on every page
 * render (the sidebar lives in the dashboard layout), so the whole
 * thing is parallelised.
 *
 * No auth yet — current user is resolved via `getCurrentUserId()` (see
 * `src/lib/current-user.ts`). When login lands, swap that helper for the
 * session resolver and every caller keeps working.
 */

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";

export type SidebarUser = {
  id: string;
  name: string;
  initials: string;
  role: string;
};

export type SidebarPinnedMatter = {
  id: string;
  name: string;
  area: string;
  color: string;
};

export type SidebarAreaCount = {
  area: string;
  count: number;
  label: string;
  color: string;
};

export type SidebarData = {
  currentUser: SidebarUser | null;
  openMatterCount: number;
  unreadEmailCount: number;
  activeLeadCount: number;
  hoursToday: number;
  pinnedMatters: SidebarPinnedMatter[];
  areaCounts: SidebarAreaCount[];
};

/** Display-label + CSS variable lookup for each practice area in the DB.
 *  Areas not in this map still render — they'll use the raw string and a
 *  neutral color. */
const AREA_META: Record<string, { label: string; color: string }> = {
  "§1983": {
    label: "§1983 · Civil rights",
    color: "var(--color-area-1983)",
  },
  "Housing/FHA": {
    label: "Housing · FHA",
    color: "var(--color-area-housing)",
  },
  "Employment/CADA": {
    label: "Employment · CADA",
    color: "var(--color-area-employment)",
  },
  Criminal: {
    label: "Criminal",
    color: "var(--color-area-criminal)",
  },
  Class: {
    label: "Class actions",
    color: "var(--color-area-class)",
  },
  ADA: {
    label: "ADA",
    color: "var(--color-area-ada)",
  },
  "Education/IDEA": {
    label: "Education · IDEA",
    color: "var(--color-area-education)",
  },
};

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

export async function getSidebarData(): Promise<SidebarData> {
  const currentUserId = await getCurrentUserId();

  const [
    user,
    openMatterCount,
    unreadEmailCount,
    activeLeadCount,
    pinnedMatters,
    areaGroups,
    hoursAgg,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: currentUserId },
      select: { id: true, name: true, initials: true, role: true },
    }),
    prisma.matter.count({
      where: { isArchived: false, NOT: { stage: { in: ["Closed", "Settled"] } } },
    }),
    prisma.emailThread.count({ where: { isRead: false } }),
    prisma.lead.count({
      where: { stage: { notIn: ["converted", "declined"] } },
    }),
    // Pinned matters for this user only, ordered by the pin createdAt
    // (most recently pinned first).
    prisma.userMatterPin.findMany({
      where: { userId: currentUserId, matter: { isArchived: false } },
      orderBy: { createdAt: "desc" },
      select: {
        matter: {
          select: { id: true, name: true, area: true, color: true },
        },
      },
    }),
    prisma.matter.groupBy({
      by: ["area"],
      where: {
        isArchived: false,
        NOT: { stage: { in: ["Closed", "Settled"] } },
      },
      _count: true,
    }),
    prisma.timeEntry.aggregate({
      where: {
        date: { gte: startOfToday(), lte: endOfToday() },
        userId: currentUserId,
      },
      _sum: { hours: true },
    }),
  ]);

  const areaCounts: SidebarAreaCount[] = areaGroups
    .map((g) => {
      const meta = AREA_META[g.area];
      return {
        area: g.area,
        count: g._count,
        label: meta?.label ?? g.area,
        color: meta?.color ?? "var(--color-ink-3)",
      };
    })
    // Sort by count desc, then label for stable ordering.
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return {
    currentUser: user,
    openMatterCount,
    unreadEmailCount,
    activeLeadCount,
    hoursToday: hoursAgg._sum.hours ?? 0,
    pinnedMatters: pinnedMatters.map((p) => p.matter),
    areaCounts,
  };
}
