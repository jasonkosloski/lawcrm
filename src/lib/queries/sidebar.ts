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
import { matterAccessWhere } from "@/lib/matter-access";
import { leadAccessWhere } from "@/lib/lead-access";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { dateOnlyRange, todayKey } from "@/lib/format-date";
import { currentUserHasPermission } from "@/lib/permission-check";
import { visibleEmailThreadWhere } from "@/lib/email-visibility";
import { LEAD_CLOSED_STAGES } from "@/lib/constants/lead-stage";

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
  /** Whether the viewer holds `reports.view` — gates the Reports
   *  nav item (the /reports page re-checks server-side, so hiding
   *  here is UX, not security). Same resolve-at-the-server, thread-
   *  as-a-flag pattern as SettingsNav's grantedPermissions. */
  canViewReports: boolean;
};

/** Shared "open matter" constraint: not archived, stage not terminal. */
const OPEN_MATTER_WHERE = {
  isArchived: false,
  stage: { isTerminal: false },
} as const;

export async function getSidebarData(): Promise<SidebarData> {
  const currentUserId = await getCurrentUserId();
  // "Today" is the VIEWER's calendar day (TimeEntry.date is a
  // date-only UTC-midnight value — ADR-012), not the server's.
  const tz = await getCurrentUserTimeZone();
  const today = todayKey(tz);
  // Ethical walls: every matter-derived figure is scoped to what the
  // viewer may see.
  const access = await matterAccessWhere(currentUserId);
  const openWhere = { ...OPEN_MATTER_WHERE, ...access };
  // Restricted intake (ADR-049): the open-leads badge counts only
  // leads the viewer may see.
  const leadAccess = await leadAccessWhere(currentUserId);

  const [
    user,
    openMatterCount,
    unreadEmailCount,
    activeLeadCount,
    pinnedMatters,
    areaGroups,
    areas,
    hoursAgg,
    canViewReports,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: currentUserId },
      select: { id: true, name: true, initials: true, jobTitle: true },
    }),
    prisma.matter.count({ where: openWhere }),
    // Own mailbox only (never coworkers' unread volume), and archived
    // threads don't count — the badge means "unread in my inbox".
    prisma.emailThread.count({
      where: {
        ...visibleEmailThreadWhere(currentUserId),
        isRead: false,
        isArchived: false,
      },
    }),
    prisma.lead.count({
      where: { ...leadAccess, stage: { notIn: [...LEAD_CLOSED_STAGES] } },
    }),
    // Pinned matters for this user only, ordered by the pin createdAt
    // (most recently pinned first).
    prisma.userMatterPin.findMany({
      where: {
        userId: currentUserId,
        matter: { ...access, isArchived: false },
      },
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
      where: openWhere,
      _count: true,
    }),
    // Fetch ALL areas (including retired ones): open matters in a
    // deactivated area still count in the groupBy above and must keep
    // their label/colour instead of showing as "(unknown)".
    prisma.practiceArea.findMany({
      select: { id: true, name: true, label: true, color: true, order: true },
    }),
    prisma.timeEntry.aggregate({
      where: {
        date: dateOnlyRange(today, today),
        userId: currentUserId,
      },
      _sum: { hours: true },
    }),
    // Permission resolution is cached per-request (React cache()),
    // so this shares the fetch with any page-level gate.
    currentUserHasPermission("reports.view"),
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
    canViewReports,
  };
}
