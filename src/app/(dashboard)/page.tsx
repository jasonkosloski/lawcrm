/**
 * Today / Dashboard Page
 *
 * The home screen of the CRM. Loads the viewer's saved layout, loads
 * data only for cards that are not hidden, and hands the rendered cards
 * to DashboardCustomizer, which renders the band + column grid and
 * owns in-place customize mode.
 *
 * All data is queried live from Prisma on each request (see
 * loadDashboardData), in parallel so render isn't bottlenecked on the
 * slowest query.
 */

import type { ReactNode } from "react";
import { after } from "next/server";
import { TopBar } from "@/components/layout/topbar";
import { DashboardCustomizer } from "@/components/dashboard/customizer";
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
import { Greeting } from "@/components/dashboard/greeting";
import type { DashboardCardKey } from "@/lib/dashboard-prefs";
import { getDashboardLayout } from "@/lib/queries/dashboard-prefs";
import { dueTodayCount, loadDashboardData } from "@/lib/queries/dashboard-data";

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

  // Layout first: a hidden card's loader is skipped entirely, so
  // hiding "Firm pulse" also skips its invoice aggregates.
  const layout = await getDashboardLayout(userId);
  const data = await loadDashboardData(layout, tz);

  // Only cards that render something for this viewer: no key means
  // "nothing to show" (hidden, or not permitted).
  const cards: Partial<Record<DashboardCardKey, ReactNode>> = {
    agenda: <AgendaCard items={data.agenda} />,
    tasks: <TasksCard tasks={data.tasks} />,
    followUps: <FollowUpsCard items={data.followUps} />,
    activity: (
      <ActivityCard
        items={data.activity}
        canViewActivityLog={data.canViewActivityLog}
      />
    ),
    deadlines: <DeadlinesCard data={data.deadlines} />,
  };
  if (data.kpis) cards.kpis = <KpisCard kpis={data.kpis} />;
  // Null without reports.view (or when hidden).
  if (data.pulse) cards.pulse = <PulseCard pulse={data.pulse} />;
  // No fee data; needs records.view.
  if (data.canViewRecords) cards.records = <RecordsCard items={data.records} />;

  // Cards this viewer may not see, so edit mode can say why one is
  // empty. A hidden card is not "unavailable" - it just isn't loaded.
  const unavailable: DashboardCardKey[] = [];
  if (!data.pulse && !layout.hidden.includes("pulse")) unavailable.push("pulse");
  if (!data.canViewRecords) unavailable.push("records");

  return (
    <>
      <TopBar title="Today" crumbs="Dashboard" />

      <div className="flex-1 overflow-y-auto p-3 sm:p-5 animate-page-enter">
        <DashboardCustomizer
          initialLayout={layout}
          cards={cards}
          unavailable={unavailable}
          greeting={<Greeting tz={tz} dueToday={dueTodayCount(data, layout)} />}
        />
      </div>
    </>
  );
}
