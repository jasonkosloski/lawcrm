/**
 * Today / Dashboard Page
 *
 * The home screen of the CRM. Three-column layout:
 * - Left: KPI tiles, today's agenda, recent activity feed
 * - Right: Deadlines this week, firm pulse
 *
 * All data is queried live from Prisma on each request. Queries run in
 * parallel at the top of the component so render isn't bottlenecked on
 * the slowest one.
 */

import { Fragment, type ReactNode } from "react";
import { after } from "next/server";
import { TopBar } from "@/components/layout/topbar";
import { DashboardCustomizeButton } from "@/components/dashboard/customize-button";
import { KpisCard } from "@/components/dashboard/cards/kpis";
import { AgendaCard } from "@/components/dashboard/cards/agenda";
import { TasksCard } from "@/components/dashboard/cards/tasks";
import { FollowUpsCard } from "@/components/dashboard/cards/follow-ups";
import { ActivityCard } from "@/components/dashboard/cards/activity";
import { DeadlinesCard } from "@/components/dashboard/cards/deadlines";
import { PulseCard } from "@/components/dashboard/cards/pulse";
import { RecordsCard } from "@/components/dashboard/cards/records";
import { getCurrentUserId } from "@/lib/current-user";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { maybeRunDeadlineNotificationSweep } from "@/lib/notification-sweeps";
import { cardsInColumn, type DashboardCardKey } from "@/lib/dashboard-prefs";
import { currentUserHasPermission } from "@/lib/permission-check";
import { getMyRecordsToChase } from "@/lib/queries/records-requests";
import { getDashboardPrefs } from "@/lib/queries/dashboard-prefs";
import {
  getDashboardKpis,
  getFirmPulse,
  getFollowUpsDueToday,
  getMyOpenTasks,
  getRecentActivity,
  getTodayAgenda,
  getUpcomingDeadlines,
  type DeadlinesCard as DeadlinesData,
  type MyTasksGrouped,
} from "@/lib/queries/dashboard";


export default async function DashboardPage() {
  // Authenticate before anything else - including the post-response
  // sweep below, which touches the DB and must not run for an
  // unauthenticated request.
  const userId = await getCurrentUserId();

  // Deadline-notification sweep as post-response work (after() keeps
  // it from competing with the render for the single pooled
  // connection and lets the platform finish it). The hourly
  // /api/notification-sweep cron is the primary driver; this is a
  // self-throttled fallback (once/hour per instance) for environments
  // without cron, e.g. local dev. It never throws.
  after(() => maybeRunDeadlineNotificationSweep());

  // "Today" everywhere below means the USER's calendar day - resolve
  // the viewer's zone once and thread it through every query (same
  // pattern as /calendar).
  const tz = await getCurrentUserTimeZone();

  // Prefs first: a hidden card's loader is skipped entirely, so
  // hiding "Firm pulse" also skips its invoice aggregates.
  const prefs = await getDashboardPrefs(userId);
  const show = prefs.visible;
  const emptyTasks: MyTasksGrouped = {
    overdue: [],
    today: [],
    thisWeek: [],
    later: [],
    noDueDate: [],
    total: 0,
    overdueCount: 0,
    hidden: 0,
  };
  const emptyDeadlines: DeadlinesData = { items: [], overdueHidden: 0 };
  // Records card: only for viewers with records.view (the loader is
  // skipped otherwise, and the card renders nothing).
  const canViewRecords = show.records
    ? await currentUserHasPermission("records.view")
    : false;
  // Activity card's "View all" needs firm.view_activity; resolved only
  // when the card is visible.
  const canViewActivityLog = show.activity
    ? await currentUserHasPermission("firm.view_activity")
    : false;
  const [kpis, agenda, activity, deadlines, pulse, myTasks, followUps, recordsToChase] =
    await Promise.all([
      show.kpis ? getDashboardKpis(tz) : Promise.resolve(null),
      show.agenda ? getTodayAgenda(tz) : Promise.resolve([]),
      show.activity ? getRecentActivity(tz, 5) : Promise.resolve([]),
      show.deadlines
        ? getUpcomingDeadlines(tz, 7)
        : Promise.resolve(emptyDeadlines),
      show.pulse ? getFirmPulse(tz) : Promise.resolve(null),
      show.tasks ? getMyOpenTasks(tz) : Promise.resolve(emptyTasks),
      show.followUps ? getFollowUpsDueToday(tz) : Promise.resolve([]),
      canViewRecords ? getMyRecordsToChase(tz) : Promise.resolve([]),
    ]);

  // Each card keyed by its pref key. The return below walks the
  // user's saved order per column (main vs. right rail) and skips
  // hidden cards. Cards keep a fixed column in v2 — the saved order
  // only moves them within it (see DASHBOARD_CARD_COLUMNS in
  // src/lib/dashboard-prefs.ts).
  const cards: Record<DashboardCardKey, ReactNode> = {
    kpis: kpis && <KpisCard kpis={kpis} />,
    agenda: <AgendaCard items={agenda} />,
    tasks: <TasksCard tasks={myTasks} />,
    followUps: <FollowUpsCard items={followUps} />,
    activity: (
      <ActivityCard
        items={activity}
        canViewActivityLog={canViewActivityLog}
      />
    ),
    deadlines: <DeadlinesCard data={deadlines} />,
    // No fee data; renders nothing without records.view.
    records: canViewRecords && <RecordsCard items={recordsToChase} />,
    // Null without reports.view — the card renders nothing.
    pulse: <PulseCard pulse={pulse} />,
  };


  return (
    <>
      <TopBar
        title="Today"
        crumbs="Dashboard"
        actions={<DashboardCustomizeButton initialPrefs={prefs} />}
      />

      <div className="flex-1 overflow-y-auto p-3 sm:p-5 animate-page-enter">
        {/* Two-column on lg+, stack on smaller. The right rail
            (deadlines + firm pulse) drops below the main column
            on mobile/tablet so the user reads top-to-bottom
            instead of side-to-side. */}
        <div className="flex flex-col lg:flex-row gap-5">
          {/* ── Main column — cards in the user's saved order ───────────── */}
          <div className="flex-1 min-w-0 flex flex-col gap-5">
            {cardsInColumn(prefs.order, "main")
              .filter((key) => prefs.visible[key])
              .map((key) => (
                <Fragment key={key}>{cards[key]}</Fragment>
              ))}
          </div>

          {/* ── Right rail — same treatment ────────────────────────────────
              At lg+ this is a 340px sidebar; below lg it stacks under the
              main column at full width. */}
          <div className="w-full lg:w-85 lg:shrink-0 flex flex-col gap-5">
            {cardsInColumn(prefs.order, "rail")
              .filter((key) => prefs.visible[key])
              .map((key) => (
                <Fragment key={key}>{cards[key]}</Fragment>
              ))}
          </div>
        </div>
      </div>
    </>
  );
}
