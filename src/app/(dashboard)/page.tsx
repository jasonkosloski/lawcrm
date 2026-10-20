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
import Link from "next/link";
import { after } from "next/server";
import { TopBar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardCustomizeButton } from "@/components/dashboard/customize-button";
import { DashboardTaskRow } from "@/components/tasks/dashboard-task-row";
import { getCurrentUserId } from "@/lib/current-user";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { maybeRunDeadlineNotificationSweep } from "@/lib/notification-sweeps";
import { formatDateOnly } from "@/lib/format-date";
import { activityIcon } from "@/lib/activity-icons";
import { cardsInColumn, type DashboardCardKey } from "@/lib/dashboard-prefs";
import { currentUserHasPermission } from "@/lib/permission-check";
import { getMyRecordsToChase } from "@/lib/queries/records-requests";
import { getDashboardPrefs } from "@/lib/queries/dashboard-prefs";
import { StatStrip, type Stat } from "@/components/shared/stat-strip";
import { DueLabel } from "@/components/shared/due-label";
import {
  getDashboardKpis,
  getFirmPulse,
  getFollowUpsDueToday,
  getMyOpenTasks,
  getRecentActivity,
  getTodayAgenda,
  getUpcomingDeadlines,
  type FollowUpItem,
  type MyTaskItem,
  type DeadlinesCard,
  type MyTasksGrouped,
} from "@/lib/queries/dashboard";

/** Format a dollar amount with comma separators, no cents. */
const formatMoney = (n: number): string =>
  `$${Math.round(n).toLocaleString("en-US")}`;

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
  const emptyDeadlines: DeadlinesCard = { items: [], overdueHidden: 0 };
  // Records card: only for viewers with records.view (the loader is
  // skipped otherwise, and the card renders nothing).
  const canViewRecords = show.records
    ? await currentUserHasPermission("records.view")
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

  const kpiStats: Stat[] = !kpis
    ? []
    : [
        {
          label: "Open matters",
          value: kpis.openMatters.toString(),
          detail: kpis.openMattersChange,
          href: "/matters",
        },
        {
          label: "Unread email",
          value: kpis.unreadEmail.toString(),
          detail:
            kpis.flaggedEmail > 0
              ? `${kpis.flaggedEmail} starred unread`
              : "None starred",
          href: "/communication?filter=unread",
        },
        {
          label: "Hours today",
          value: kpis.hoursToday.toFixed(1),
          detail: `Goal ${kpis.hoursGoal.toFixed(1)}`,
          href: "/time",
        },
        // Firm-wide trust total: null (cell omitted) without reports.view.
        ...(kpis.trustBalance !== null
          ? [
              {
                label: "Trust balance",
                value: formatMoney(kpis.trustBalance),
                detail: `Across ${kpis.trustMatterCount ?? 0} matters`,
              },
            ]
          : []),
      ];

  const mtdPct = pulse
    ? Math.min(100, (pulse.billableMtd / pulse.billableGoal) * 100)
    : 0;

  // Each card keyed by its pref key. The return below walks the
  // user's saved order per column (main vs. right rail) and skips
  // hidden cards. Cards keep a fixed column in v2 — the saved order
  // only moves them within it (see DASHBOARD_CARD_COLUMNS in
  // src/lib/dashboard-prefs.ts).
  const cards: Record<DashboardCardKey, ReactNode> = {
    // KPI tile grid — 1 / 2 / 4 columns at xs / sm / lg+.
    kpis: <StatStrip stats={kpiStats} />,

    // Today's agenda
    agenda: (
            <Card>
              <CardHeader className="pb-1">
                <CardTitle>
                  Today&apos;s agenda
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {agenda.length === 0 ? (
                  <div className="py-3 text-xs text-ink-4">
                    No events scheduled for today.
                  </div>
                ) : (
                  <div className="flex flex-col">
                    {agenda.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 py-2.5 border-b border-line-2 last:border-b-0"
                      >
                        <span className="text-xs text-ink-3 tabular-nums w-16 shrink-0">
                          {item.time}
                        </span>
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ background: item.color }}
                        />
                        <span className="text-sm text-ink truncate">{item.title}</span>
                        <span className="ml-auto text-2xs text-ink-4 shrink-0">
                          {item.area}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
    ),

    // Your tasks (assigned to current user, grouped by due date)
    tasks: (
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="flex items-center gap-2">
                  Your tasks
                  <span className="text-xs font-normal text-ink-4 tabular-nums">
                    {myTasks.total}
                  </span>
                  {myTasks.overdueCount > 0 && (
                    <span className="ml-auto text-2xs font-medium px-2 py-0.5 rounded-full bg-danger-soft text-danger">
                      {myTasks.overdueCount} overdue
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {myTasks.total === 0 ? (
                  <div className="py-3 text-xs text-ink-4">
                    Nothing on your plate. Inbox zero.
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <TaskGroup label="Overdue" tone="warn" tasks={myTasks.overdue} />
                    <TaskGroup label="Today" tone="brand" tasks={myTasks.today} />
                    <TaskGroup label="This week" tone="muted" tasks={myTasks.thisWeek} />
                    <TaskGroup label="Later" tone="muted" tasks={myTasks.later} />
                    <TaskGroup label="No due date" tone="muted" tasks={myTasks.noDueDate} />
                    {myTasks.hidden > 0 && (
                      <div className="text-2xs text-ink-4">
                        +{myTasks.hidden} more not shown
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
    ),

    // Follow up today (email + messenger threads with a snooze
    // date today or earlier — overdue ones bubble to the top)
    followUps: (
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="flex items-center gap-2">
                  Follow up today
                  <span className="text-xs font-normal text-ink-4 tabular-nums">
                    {followUps.length}
                  </span>
                  {followUps.some((f) => f.isOverdue) && (
                    <span className="ml-auto text-2xs font-medium px-2 py-0.5 rounded-full bg-danger-soft text-danger">
                      {followUps.filter((f) => f.isOverdue).length} overdue
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {followUps.length === 0 ? (
                  <div className="py-3 text-xs text-ink-4">
                    Nothing flagged for today. Snooze a thread by clicking
                    the bell on its reader header.
                  </div>
                ) : (
                  <div className="flex flex-col">
                    {followUps.map((f) => (
                      <FollowUpRow key={`${f.kind}-${f.id}`} item={f} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
    ),

    // Recent activity
    activity: (
            <Card>
              <CardHeader className="pb-1">
                <CardTitle>
                  Recent activity
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {activity.length === 0 ? (
                  <div className="py-3 text-xs text-ink-4">
                    No recent activity.
                  </div>
                ) : (
                  <div className="flex flex-col">
                    {activity.map((item) => {
                      const Icon = activityIcon(item.iconName);
                      return (
                        <div
                          key={item.id}
                          className="flex items-start gap-3 py-2.5 border-b border-line last:border-b-0"
                        >
                          <Icon
                            size={16}
                            strokeWidth={1.75}
                            aria-hidden
                            className="text-ink-4 shrink-0 mt-0.5"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-ink">
                              {item.title}
                            </div>
                            <div className="text-2xs text-ink-3 truncate">
                              {item.detail}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-0.5 shrink-0">
                            <span className="text-2xs text-ink-4 tabular-nums">
                              {item.time}
                            </span>
                            <span className="text-2xs text-ink-4">
                              {item.source}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
    ),

    // Deadlines this week (right rail)
    deadlines: (
            <Card>
              <CardHeader className="pb-1">
                <CardTitle>
                  Deadlines this week
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {deadlines.items.length === 0 ? (
                  <div className="py-3 text-xs text-ink-4">
                    No open deadlines due in the next 7 days.
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {deadlines.items.map((d) => (
                      <Link
                        key={d.id}
                        href={`/matters/${d.matterId}/deadlines`}
                        className="flex items-center gap-3 py-2.5 border-b border-line-2 last:border-b-0 hover:bg-paper -mx-2 px-2 rounded-md transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 text-xs text-ink">
                            <span className="truncate">{d.title}</span>
                            {d.kind === "critical" && (
                              <span className="shrink-0 text-2xs font-medium text-danger">
                                Critical
                              </span>
                            )}
                          </div>
                          <div className="text-2xs text-ink-4 truncate">
                            {d.matterName}
                          </div>
                        </div>
                        <DueLabel
                          dueDate={d.dueDate}
                          days={d.days}
                          className="shrink-0"
                        />
                      </Link>
                    ))}
                    {deadlines.overdueHidden > 0 && (
                      <div className="pt-2 text-2xs text-ink-4">
                        +{deadlines.overdueHidden} more overdue
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
    ),

    // Records to chase (right rail) — viewer's overdue / due-soon requests.
    // No fee data; renders nothing without records.view.
    records: canViewRecords && (
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="flex items-center gap-2">
                  Records to chase
                  <span className="text-xs font-normal text-ink-4 tabular-nums">
                    {recordsToChase.length}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {recordsToChase.length === 0 ? (
                  <div className="py-3 text-xs text-ink-4">
                    No records requests need a nudge this week.
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {recordsToChase.map((r) => (
                      <Link
                        key={r.id}
                        href={r.href}
                        className="flex items-center gap-3 py-2.5 border-b border-line-2 last:border-b-0 hover:bg-paper -mx-2 px-2 rounded-md transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-ink truncate">{r.subject}</div>
                          <div className="text-2xs text-ink-4 truncate">
                            {r.custodianName} · {r.context}
                          </div>
                        </div>
                        <span
                          className={`text-2xs tabular-nums shrink-0 ${
                            r.label.endsWith("overdue")
                              ? "text-danger font-medium"
                              : "text-ink-4"
                          }`}
                        >
                          {r.label}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
    ),

    // Firm pulse (right rail)
    // Null without reports.view — the card renders nothing.
    pulse: pulse && (
            <Card>
              <CardHeader className="pb-1">
                <CardTitle>
                  Firm pulse
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-ink-3">
                      Billable hours this month
                    </span>
                    <span className="text-sm font-medium text-ink tabular-nums">
                      {pulse.billableMtd.toFixed(1)}h
                    </span>
                  </div>
                  <div className="h-1.5 bg-paper-2 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand-700 rounded-full"
                      style={{ width: `${mtdPct}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-ink-3">
                      Collection rate
                    </span>
                    <span className="text-sm font-medium text-ink tabular-nums">
                      {pulse.collectionRate > 0
                        ? `${pulse.collectionRate.toFixed(1)}%`
                        : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-ink-3">
                      A/R outstanding
                    </span>
                    <span className="text-sm font-medium text-ink tabular-nums">
                      {pulse.arOutstanding > 0
                        ? formatMoney(pulse.arOutstanding)
                        : "—"}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
    ),
  };

  return (
    <>
      <TopBar
        title="Today"
        actions={<DashboardCustomizeButton initialPrefs={prefs} />}
      />

      <div className="flex-1 overflow-y-auto p-3 sm:p-6 animate-page-enter">
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

/** Format a task's due date as a short relative or absolute label. */
const formatTaskDue = (task: MyTaskItem): string => {
  if (task.dueDate === null || task.daysUntilDue === null) return "—";
  if (task.daysUntilDue < 0) return `${Math.abs(task.daysUntilDue)}d late`;
  if (task.daysUntilDue === 0) return "today";
  if (task.daysUntilDue === 1) return "tomorrow";
  if (task.daysUntilDue <= 7) return `${task.daysUntilDue}d`;
  // Date-only value (ADR-012): read in UTC, never shifted by a zone.
  return formatDateOnly(task.dueDate, "short");
};

/**
 * One bucket of tasks (Overdue / Today / This week / etc.) inside the
 * "Your tasks" card. Renders nothing when empty so we don't clutter the
 * card with empty headers. The actual row markup + per-task kebab
 * (Log time / Add note) live in `DashboardTaskRow` so this stays
 * server-rendered.
 */
function TaskGroup({
  label,
  tone,
  tasks,
}: {
  label: string;
  tone: "warn" | "brand" | "muted";
  tasks: MyTaskItem[];
}) {
  if (tasks.length === 0) return null;
  const labelClass =
    tone === "warn"
      ? "text-danger"
      : tone === "brand"
        ? "text-ink"
        : "text-ink-3";
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span
          className={`text-xs font-semibold ${labelClass}`}
        >
          {label}
        </span>
        <span className="text-2xs text-ink-4 tabular-nums">{tasks.length}</span>
      </div>
      <div className="flex flex-col">
        {tasks.map((t) => (
          <DashboardTaskRow
            key={t.id}
            id={t.id}
            title={t.title}
            priority={t.priority}
            matterId={t.matterId}
            leadId={t.leadId}
            matterName={t.matterName}
            daysUntilDue={t.daysUntilDue}
            dueLabel={formatTaskDue(t)}
          />
        ))}
      </div>
    </div>
  );
}

/** Row in the dashboard "Follow up today" card. Click navigates to
 *  the source thread (matter-scoped for filed email; firm-wide for
 *  messenger which doesn't have a matter-scoped view yet). */
function FollowUpRow({ item }: { item: FollowUpItem }) {
  const href =
    item.kind === "email"
      ? // No matter-scoped messenger view; matter-scoped email view exists.
        `/communication?view=email&thread=${item.id}`
      : `/communication?view=messages&thread=${item.id}`;
  return (
    <Link
      href={href}
      className="flex items-center gap-3 py-2.5 border-b border-line-2 last:border-b-0 hover:bg-paper -mx-2 px-2 rounded-md transition-colors"
    >
      <span
        className={
          "w-1.5 h-1.5 rounded-full shrink-0 " +
          (item.isOverdue ? "bg-danger" : "bg-ink-5")
        }
      />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-ink truncate">{item.label}</div>
        {item.matterName && (
          <div className="text-2xs text-ink-4 truncate">
            {item.matterName}
          </div>
        )}
      </div>
      <span
        className={
          "text-2xs shrink-0 " +
          (item.isOverdue ? "text-danger font-medium" : "text-ink-4")
        }
      >
        {item.kind === "email" ? "Email" : "Message"}
        {" · "}
        {item.isOverdue ? "Late" : "Today"}
      </span>
    </Link>
  );
}
