/**
 * Dashboard data loading, driven by the viewer's layout.
 *
 * A card in `layout.hidden` has its loader skipped entirely (hiding
 * "Firm pulse" also skips its invoice aggregates). Permission checks
 * are resolved only for cards that are shown.
 */

import type { DashboardCardKey, DashboardLayout } from "@/lib/dashboard-prefs";
import { currentUserHasPermission } from "@/lib/permission-check";
import {
  getMyRecordsToChase,
  type RecordsChaseItem,
} from "@/lib/queries/records-requests";
import {
  getDashboardKpis,
  getFirmPulse,
  getFollowUpsDueToday,
  getMyOpenTasks,
  getRecentActivity,
  getTodayAgenda,
  getUpcomingDeadlines,
  type ActivityItem,
  type AgendaItem,
  type DashboardKpis,
  type DeadlinesCard as DeadlinesData,
  type FirmPulse,
  type FollowUpItem,
  type MyTasksGrouped,
} from "@/lib/queries/dashboard";

export type DashboardData = {
  kpis: DashboardKpis | null;
  agenda: AgendaItem[];
  activity: ActivityItem[];
  canViewActivityLog: boolean;
  deadlines: DeadlinesData;
  pulse: FirmPulse | null;
  tasks: MyTasksGrouped;
  followUps: FollowUpItem[];
  records: RecordsChaseItem[];
  canViewRecords: boolean;
};

const emptyTasks = (): MyTasksGrouped => ({
  overdue: [],
  today: [],
  thisWeek: [],
  later: [],
  noDueDate: [],
  total: 0,
  overdueCount: 0,
  hidden: 0,
});

export async function loadDashboardData(
  layout: DashboardLayout,
  tz: string,
): Promise<DashboardData> {
  const shown = (key: DashboardCardKey) => !layout.hidden.includes(key);

  const [canViewRecords, canViewActivityLog] = await Promise.all([
    shown("records")
      ? currentUserHasPermission("records.view")
      : Promise.resolve(false),
    shown("activity")
      ? currentUserHasPermission("firm.view_activity")
      : Promise.resolve(false),
  ]);

  const [kpis, agenda, activity, deadlines, pulse, tasks, followUps, records] =
    await Promise.all([
      shown("kpis") ? getDashboardKpis(tz) : Promise.resolve(null),
      shown("agenda") ? getTodayAgenda(tz) : Promise.resolve([]),
      shown("activity") ? getRecentActivity(tz, 5) : Promise.resolve([]),
      shown("deadlines")
        ? getUpcomingDeadlines(tz, 7)
        : Promise.resolve({ items: [], overdueHidden: 0 } as DeadlinesData),
      shown("pulse") ? getFirmPulse(tz) : Promise.resolve(null),
      shown("tasks") ? getMyOpenTasks(tz) : Promise.resolve(emptyTasks()),
      shown("followUps") ? getFollowUpsDueToday(tz) : Promise.resolve([]),
      canViewRecords ? getMyRecordsToChase(tz) : Promise.resolve([]),
    ]);

  return {
    kpis,
    agenda,
    activity,
    canViewActivityLog,
    deadlines,
    pulse,
    tasks,
    followUps,
    records,
    canViewRecords,
  };
}

/** Tasks due today + deadlines due today; null when neither card is shown. */
export function dueTodayCount(
  data: DashboardData,
  layout: DashboardLayout,
): number | null {
  const tasksShown = !layout.hidden.includes("tasks");
  const deadlinesShown = !layout.hidden.includes("deadlines");
  if (!tasksShown && !deadlinesShown) return null;
  return (
    data.tasks.today.length +
    data.deadlines.items.filter((d) => d.days === 0).length
  );
}

/**
 * Cards this viewer may not see (drives the edit-mode "Not available
 * for your role" note). A hidden card is never "unavailable": its
 * loader and permission check were skipped, so it just isn't loaded.
 */
export function unavailableCards(
  data: DashboardData,
  layout: DashboardLayout,
): DashboardCardKey[] {
  const out: DashboardCardKey[] = [];
  if (!data.pulse && !layout.hidden.includes("pulse")) out.push("pulse");
  if (!data.canViewRecords && !layout.hidden.includes("records"))
    out.push("records");
  return out;
}
