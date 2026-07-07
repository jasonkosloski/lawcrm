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
import { TopBar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardCustomizeButton } from "@/components/dashboard/customize-button";
import { DashboardTaskRow } from "@/components/tasks/dashboard-task-row";
import { getCurrentUserId } from "@/lib/current-user";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { maybeRunDeadlineNotificationSweep } from "@/lib/notification-sweeps";
import { formatDate } from "@/lib/format-date";
import { cardsInColumn, type DashboardCardKey } from "@/lib/dashboard-prefs";
import { getDashboardPrefs } from "@/lib/queries/dashboard-prefs";
import {
  Briefcase,
  Check,
  Circle,
  Clock,
  DollarSign,
  FileText,
  Gavel,
  Mail,
  Phone,
  StickyNote,
  Video,
  Zap,
  type LucideIcon,
} from "lucide-react";
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
} from "@/lib/queries/dashboard";

/** Format a dollar amount with comma separators, no cents. */
const formatMoney = (n: number): string =>
  `$${Math.round(n).toLocaleString("en-US")}`;

/** Map activity-log icon names (stored as strings in DB) to lucide
 *  icons. Keep this in sync with `defaultIconFor()` in
 *  `src/lib/activity-log.ts`. */
const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  gavel: Gavel,
  mail: Mail,
  phone: Phone,
  video: Video,
  check: Check,
  zap: Zap,
  note: StickyNote,
  document: FileText,
  clock: Clock,
};

export default async function DashboardPage() {
  // Opportunistic deadline sweep — fire-and-forget (never blocks the
  // render, never throws) and self-throttled to once/hour per
  // instance. The dashboard is the highest-traffic page, so it
  // doubles as the poor-man's cron until a platform cron drives
  // /api/notification-sweep.
  void maybeRunDeadlineNotificationSweep();

  const userId = await getCurrentUserId();
  // "Today" everywhere below means the USER's calendar day — resolve
  // the viewer's zone once and thread it through every query (same
  // pattern as /calendar). Sequential await before the fan-out: the
  // queries all need it.
  const tz = await getCurrentUserTimeZone();
  const [
    kpis,
    agenda,
    activity,
    deadlines,
    pulse,
    myTasks,
    followUps,
    prefs,
  ] = await Promise.all([
    getDashboardKpis(tz),
    getTodayAgenda(tz),
    getRecentActivity(tz, 5),
    getUpcomingDeadlines(tz, 7),
    getFirmPulse(tz),
    getMyOpenTasks(tz),
    getFollowUpsDueToday(tz),
    getDashboardPrefs(userId),
  ]);

  const kpiTiles = [
    {
      label: "Open matters",
      value: kpis.openMatters.toString(),
      change: kpis.openMattersChange,
      icon: Briefcase,
      variant: "accent" as const,
    },
    {
      label: "Unread email",
      value: kpis.unreadEmail.toString(),
      change: kpis.flaggedEmail > 0 ? `${kpis.flaggedEmail} flagged` : "none flagged",
      icon: Mail,
      variant: kpis.flaggedEmail > 0 ? ("critical" as const) : ("accent" as const),
    },
    {
      label: "Hours today",
      value: kpis.hoursToday.toFixed(1),
      change: `${kpis.hoursGoal.toFixed(1)} goal`,
      icon: Clock,
      variant: "accent" as const,
    },
    {
      label: "Trust balance",
      value: formatMoney(kpis.trustBalance),
      change: `across ${kpis.trustMatterCount} matters`,
      icon: DollarSign,
      variant: "ok" as const,
    },
  ];

  const mtdPct = Math.min(100, (pulse.billableMtd / pulse.billableGoal) * 100);

  // Each card keyed by its pref key. The return below walks the
  // user's saved order per column (main vs. right rail) and skips
  // hidden cards. Cards keep a fixed column in v2 — the saved order
  // only moves them within it (see DASHBOARD_CARD_COLUMNS in
  // src/lib/dashboard-prefs.ts).
  const cards: Record<DashboardCardKey, ReactNode> = {
    // KPI tile grid — 1 / 2 / 4 columns at xs / sm / lg+.
    kpis: (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {kpiTiles.map((kpi) => {
                const Icon = kpi.icon;
                const variantClass =
                  kpi.variant === "critical"
                    ? "kpi-accent kpi-critical"
                    : kpi.variant === "ok"
                      ? "kpi-accent kpi-ok"
                      : "kpi-accent";
                const badgeClass =
                  kpi.variant === "critical"
                    ? "bg-warn shadow-[0_4px_10px_-4px_rgba(182,98,61,0.55)]"
                    : kpi.variant === "ok"
                      ? "bg-ok shadow-[0_4px_10px_-4px_rgba(45,138,95,0.5)]"
                      : "bg-brand-500 shadow-[0_4px_10px_-4px_rgba(37,99,168,0.6)]";

                return (
                  <Card
                    key={kpi.label}
                    className={`${variantClass} card-hover relative`}
                  >
                    <CardContent className="p-3">
                      <div
                        className={`absolute top-2.5 right-2.5 w-7 h-7 rounded-lg flex items-center justify-center text-white ${badgeClass}`}
                      >
                        <Icon size={14} />
                      </div>

                      <div className="text-2xs font-semibold uppercase tracking-wider text-ink-3 mb-1">
                        {kpi.label}
                      </div>
                      <div className="text-2xl font-display font-medium tracking-tight text-ink">
                        {kpi.value}
                      </div>
                      <div className="text-2xs text-ink-4 mt-0.5">
                        {kpi.change}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
    ),

    // Today's agenda
    agenda: (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">
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
                        className="flex items-center gap-3 py-2 border-b border-line last:border-b-0"
                      >
                        <span className="text-2xs font-mono text-ink-4 w-12 shrink-0">
                          {item.time}
                        </span>
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ background: item.color }}
                        />
                        <span className="text-xs text-ink">{item.title}</span>
                        <span className="ml-auto text-2xs font-mono text-ink-4">
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
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  Your tasks
                  <span className="text-2xs font-mono font-normal text-ink-4">
                    {myTasks.total}
                  </span>
                  {myTasks.overdue.length > 0 && (
                    <span className="ml-auto text-2xs font-mono font-medium px-2 py-0.5 rounded-full bg-warn-soft text-warn border border-warn-border">
                      {myTasks.overdue.length} overdue
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
                  </div>
                )}
              </CardContent>
            </Card>
    ),

    // Follow up today (email + messenger threads with a snooze
    // date today or earlier — overdue ones bubble to the top)
    followUps: (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  Follow up today
                  <span className="text-2xs font-mono font-normal text-ink-4">
                    {followUps.length}
                  </span>
                  {followUps.some((f) => f.isOverdue) && (
                    <span className="ml-auto text-2xs font-mono font-medium px-2 py-0.5 rounded-full bg-warn-soft text-warn border border-warn-border">
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
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">
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
                      const Icon = ACTIVITY_ICONS[item.iconName] ?? Circle;
                      return (
                        <div
                          key={item.id}
                          className="flex items-start gap-3 py-2.5 border-b border-line last:border-b-0"
                        >
                          <div className="w-7 h-7 rounded-md bg-brand-50 flex items-center justify-center shrink-0 mt-0.5">
                            <Icon size={13} className="text-brand-500" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-ink">
                              {item.title}
                            </div>
                            <div className="text-2xs text-ink-3 truncate">
                              {item.detail}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-0.5 shrink-0">
                            <span className="text-2xs font-mono text-ink-4">
                              {item.time}
                            </span>
                            <span className="text-3xs font-mono uppercase tracking-wider text-ink-4">
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
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">
                  Deadlines this week
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {deadlines.length === 0 ? (
                  <div className="py-3 text-xs text-ink-4">
                    No deadlines in the next 7 days.
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {deadlines.map((d) => (
                      <div
                        key={d.id}
                        className="flex items-center gap-3 py-2 border-b border-line last:border-b-0"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-ink truncate">
                            {d.title}
                          </div>
                        </div>
                        <span
                          className={`text-2xs font-mono font-medium px-2 py-0.5 rounded-full border ${
                            d.kind === "critical"
                              ? "bg-warn-soft text-warn border-warn-border"
                              : d.kind === "auto_rule"
                                ? "bg-brand-soft text-brand-700 border-brand-200"
                                : "bg-paper-2 text-ink-3 border-line"
                          }`}
                        >
                          {d.days}d
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
    ),

    // Firm pulse (right rail)
    pulse: (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">
                  Firm pulse
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-2xs text-ink-3">
                      Billable hours (MTD)
                    </span>
                    <span className="text-xs font-mono font-medium text-ink">
                      {pulse.billableMtd.toFixed(1)}h
                    </span>
                  </div>
                  <div className="h-1.5 bg-paper-2 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand-500 rounded-full"
                      style={{ width: `${mtdPct}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-2xs text-ink-3">
                      Collection rate
                    </span>
                    <span className="text-xs font-mono font-medium text-ok">
                      {pulse.collectionRate > 0
                        ? `${pulse.collectionRate.toFixed(1)}%`
                        : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-2xs text-ink-3">
                      A/R outstanding
                    </span>
                    <span className="text-xs font-mono font-medium text-ink">
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

/** Format a task's due date as a short relative or absolute label. */
const formatTaskDue = (task: MyTaskItem): string => {
  if (task.dueDate === null || task.daysUntilDue === null) return "—";
  if (task.daysUntilDue < 0) return `${Math.abs(task.daysUntilDue)}d late`;
  if (task.daysUntilDue === 0) return "today";
  if (task.daysUntilDue === 1) return "tomorrow";
  if (task.daysUntilDue <= 7) return `${task.daysUntilDue}d`;
  // Date-only value (stored at server-local midnight) — format in
  // server TZ, no user-TZ override, or the day could shift.
  return formatDate(task.dueDate, "short");
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
      ? "text-warn"
      : tone === "brand"
        ? "text-brand-700"
        : "text-ink-3";
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span
          className={`text-2xs font-semibold uppercase tracking-wider ${labelClass}`}
        >
          {label}
        </span>
        <span className="text-2xs font-mono text-ink-4">{tasks.length}</span>
      </div>
      <div className="flex flex-col">
        {tasks.map((t) => (
          <DashboardTaskRow
            key={t.id}
            id={t.id}
            title={t.title}
            priority={t.priority}
            matterId={t.matterId}
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
      className="flex items-center gap-3 py-2 border-b border-line last:border-b-0 hover:bg-paper-2 -mx-2 px-2 rounded-sm transition-colors"
    >
      <span
        className={
          "w-1.5 h-1.5 rounded-full shrink-0 " +
          (item.isOverdue ? "bg-warn" : "bg-brand-500")
        }
      />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-ink truncate">{item.label}</div>
        {item.matterName && (
          <div className="text-3xs font-mono uppercase tracking-wider text-ink-4 truncate">
            {item.matterName}
          </div>
        )}
      </div>
      <span
        className={
          "text-2xs font-mono shrink-0 " +
          (item.isOverdue ? "text-warn font-medium" : "text-ink-4")
        }
      >
        {item.kind === "email" ? "✉ " : "💬 "}
        {item.isOverdue ? "Late" : "Today"}
      </span>
    </Link>
  );
}
