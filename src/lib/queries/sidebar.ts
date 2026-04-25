/**
 * Sidebar Queries
 *
 * One aggregate fetch for everything the sidebar displays: the current
 * user, nav badges (open matters, unread email, today's hours, active
 * leads), practice-area counts, and pinned matters. Runs on every page
 * render (the sidebar lives in the dashboard layout), so the whole
 * thing is parallelised.
 *
 * Practice-area labels + colors come from the `practice_areas` table,
 * not a hardcoded map — so firm-admin changes in settings flow through
 * without code edits. "Open" matter counts exclude archived matters and
 * stages flagged `isTerminal` (Settled/Closed by default).
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
  jobTitle: string;
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

/** Shared "open matter" constraint: not archived, stage not terminal. */
const OPEN_MATTER_WHERE = {
  isArchived: false,
  stage: { isTerminal: false },
} as const;

export async function getSidebarData(): Promise<SidebarData> {
  const currentUserId = await getCurrentUserId();

  const [
    user,
    openMatterCount,
    unreadEmailCount,
    activeLeadCount,
    pinnedMatters,
    areaGroups,
    areas,
    hoursAgg,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: currentUserId },
      select: { id: true, name: true, initials: true, jobTitle: true },
    }),
    prisma.matter.count({ where: OPEN_MATTER_WHERE }),
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
          select: {
            id: true,
            name: true,
            color: true,
            practiceArea: { select: { name: true } },
          },
        },
      },
    }),
    prisma.matter.groupBy({
      by: ["practiceAreaId"],
      where: OPEN_MATTER_WHERE,
      _count: true,
    }),
    // Fetch all active areas so we can join labels/colors onto the groups.
    prisma.practiceArea.findMany({
      where: { isActive: true },
      select: { id: true, name: true, label: true, color: true, order: true },
    }),
    prisma.timeEntry.aggregate({
      where: {
        date: { gte: startOfToday(), lte: endOfToday() },
        userId: currentUserId,
      },
      _sum: { hours: true },
    }),
  ]);

  const areaById = new Map(areas.map((a) => [a.id, a]));

  const areaCounts: SidebarAreaCount[] = areaGroups
    .map((g) => {
      const meta = areaById.get(g.practiceAreaId);
      return {
        area: meta?.name ?? "(unknown)",
        count: g._count,
        label: meta?.label ?? meta?.name ?? "(unknown)",
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
    pinnedMatters: pinnedMatters.map((p) => ({
      id: p.matter.id,
      name: p.matter.name,
      area: p.matter.practiceArea.name,
      color: p.matter.color,
    })),
    areaCounts,
  };
}
