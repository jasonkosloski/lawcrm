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

import { TopBar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Briefcase,
  Check,
  Circle,
  Clock,
  DollarSign,
  FileText,
  Gavel,
  Mail,
  StickyNote,
  Video,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  getDashboardKpis,
  getFirmPulse,
  getRecentActivity,
  getTodayAgenda,
  getUpcomingDeadlines,
} from "@/lib/queries/dashboard";

/** Format a dollar amount with comma separators, no cents. */
const formatMoney = (n: number): string =>
  `$${Math.round(n).toLocaleString("en-US")}`;

/** Map activity-log icon names (stored as strings in DB) to lucide icons. */
const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  gavel: Gavel,
  mail: Mail,
  video: Video,
  check: Check,
  zap: Zap,
  note: StickyNote,
  document: FileText,
};

export default async function DashboardPage() {
  const [kpis, agenda, activity, deadlines, pulse] = await Promise.all([
    getDashboardKpis(),
    getTodayAgenda(),
    getRecentActivity(5),
    getUpcomingDeadlines(7),
    getFirmPulse(),
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

  return (
    <>
      <TopBar title="Today" crumbs="Dashboard" />

      <div className="flex-1 overflow-y-auto p-5 animate-page-enter">
        <div className="flex gap-5">
          {/* ── Left column (flex) ──────────────────────────────────────── */}
          <div className="flex-1 min-w-0 flex flex-col gap-5">
            {/* KPI tile grid */}
            <div className="grid grid-cols-4 gap-4">
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

            {/* Today's agenda */}
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

            {/* Recent activity */}
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
          </div>

          {/* ── Right column (340px = w-85 in Tailwind spacing scale) ──── */}
          <div className="w-85 shrink-0 flex flex-col gap-5">
            {/* Deadlines this week */}
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

            {/* Firm pulse */}
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
          </div>
        </div>
      </div>
    </>
  );
}
