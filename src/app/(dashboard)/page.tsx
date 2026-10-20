/**
 * Today / Dashboard Page
 *
 * The home screen of the CRM. Renders the viewer's saved layout: a
 * full-width band of cards, then a 12-col grid whose columns follow the
 * layout's split (SPLIT_SPANS); below lg everything stacks in order.
 * Hidden cards are neither loaded nor rendered.
 *
 * All data is queried live from Prisma on each request (see
 * loadDashboardData), in parallel so render isn't bottlenecked on the
 * slowest query.
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
import { Greeting } from "@/components/dashboard/greeting";
import { SPLIT_SPANS, type DashboardCardKey } from "@/lib/dashboard-prefs";
import {
  getDashboardLayout,
  getDashboardPrefs,
} from "@/lib/queries/dashboard-prefs";
import { dueTodayCount, loadDashboardData } from "@/lib/queries/dashboard-data";
// Literal class strings so Tailwind generates them.
const SPAN_CLASS: Record<number, string> = {
  4: "lg:col-span-4",
  6: "lg:col-span-6",
  8: "lg:col-span-8",
  12: "lg:col-span-12",
};

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

  // Popover (removed in a later task) still reads the v2 prefs.
  const prefs = await getDashboardPrefs(userId);
  // Layout first: a hidden card's loader is skipped entirely, so
  // hiding "Firm pulse" also skips its invoice aggregates.
  const layout = await getDashboardLayout(userId);
  const data = await loadDashboardData(layout, tz);

  const cards: Record<DashboardCardKey, ReactNode> = {
    kpis: data.kpis && <KpisCard kpis={data.kpis} />,
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
    // No fee data; renders nothing without records.view.
    records: data.canViewRecords && <RecordsCard items={data.records} />,
    // Null without reports.view - the card renders nothing.
    pulse: <PulseCard pulse={data.pulse} />,
  };

  const renderCards = (keys: DashboardCardKey[]) =>
    keys
      .filter((key) => !layout.hidden.includes(key))
      .map((key) => <Fragment key={key}>{cards[key]}</Fragment>);

  const spans = SPLIT_SPANS[layout.split];

  return (
    <>
      <TopBar
        title="Today"
        crumbs="Dashboard"
        actions={<DashboardCustomizeButton initialPrefs={prefs} />}
      />

      <div className="flex-1 overflow-y-auto p-3 sm:p-5 animate-page-enter">
        <Greeting tz={tz} dueToday={dueTodayCount(data, layout)} />

        {/* Band: full-width cards stacked above the columns. */}
        <div className="flex flex-col gap-5">{renderCards(layout.band)}</div>

        {/* Columns: one per span of the layout's split at lg+; below lg
            everything stacks in order (band, column 0, column 1, ...). */}
        <div className="mt-5 grid grid-cols-12 gap-5">
          {spans.map((span, i) => (
            <div
              key={i}
              className={`col-span-12 min-w-0 flex flex-col gap-5 ${SPAN_CLASS[span]}`}
            >
              {renderCards(layout.columns[i] ?? [])}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
