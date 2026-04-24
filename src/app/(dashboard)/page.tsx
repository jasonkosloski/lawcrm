/**
 * Today / Dashboard Page
 *
 * The home screen of the CRM. Shows a three-column layout:
 * - Left: KPI tiles, today's agenda, recent activity feed
 * - Right (340px): Deadlines this week, upcoming conflicts queue, firm pulse
 *
 * This is a placeholder that demonstrates the app shell, design tokens,
 * and component patterns. Real data will be wired incrementally.
 */

import { TopBar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Briefcase,
  Clock,
  Hash,
  DollarSign,
  Gavel,
  Mail,
  Video,
  Check,
  Zap,
} from "lucide-react";

/** KPI data — will be replaced with real queries. */
const KPI_TILES = [
  {
    label: "Open matters",
    value: "34",
    change: "+2 this week",
    icon: Briefcase,
    variant: "accent" as const,
  },
  {
    label: "Unread email",
    value: "12",
    change: "3 flagged",
    icon: Mail,
    variant: "critical" as const,
  },
  {
    label: "Hours today",
    value: "4.2",
    change: "6.0 goal",
    icon: Clock,
    variant: "accent" as const,
  },
  {
    label: "Trust balance",
    value: "$142,800",
    change: "across 6 matters",
    icon: DollarSign,
    variant: "ok" as const,
  },
];

/** Today's agenda mock data. */
const AGENDA = [
  { time: "9:00a", title: "Alvarez — deposition prep", area: "§1983", color: "var(--color-area-1983)" },
  { time: "10:30a", title: "Williams — status conference call", area: "§1983", color: "var(--color-area-1983)" },
  { time: "1:00p", title: "Intake — Patel phone screen", area: "Housing", color: "var(--color-area-housing)" },
  { time: "2:30p", title: "Rivera — settlement distribution review", area: "§1983", color: "var(--color-area-1983)" },
  { time: "4:00p", title: "Team standup", area: "Firm", color: "var(--color-ink-3)" },
];

/** Recent activity feed mock data. */
const ACTIVITY = [
  { icon: Gavel, title: "PACER filing received — Alvarez", detail: "ECF #42 · Order on MTC", time: "2h ago", source: "PACER" },
  { icon: Mail, title: "Email from opposing counsel — Williams", detail: "Re: Rule 26 disclosures", time: "3h ago", source: "Email" },
  { icon: Video, title: "Evidence synced — Alvarez", detail: "BWC · Officer Doe #4412 · 14:22", time: "5h ago", source: "Evidence" },
  { icon: Check, title: "Task completed — Rivera lien negotiation", detail: "Memorial Hospital · $12,400 → $8,200", time: "yest.", source: "Task" },
  { icon: Zap, title: "Automation ran — CGIA notice", detail: "Patel intake → CGIA notice generated", time: "yest.", source: "Automation" },
];

/** Deadlines this week. */
const DEADLINES = [
  { title: "CGIA notice — Patel", days: 2, kind: "critical" as const },
  { title: "Discovery cutoff — Williams", days: 4, kind: "auto_rule" as const },
  { title: "Expert report deadline — Alvarez", days: 5, kind: "auto_rule" as const },
  { title: "Client meeting — Rivera", days: 6, kind: "manual" as const },
];

export default function DashboardPage() {
  return (
    <>
      <TopBar title="Today" crumbs="Dashboard" />

      <div className="flex-1 overflow-y-auto p-5 animate-page-enter">
        <div className="flex gap-5">
          {/* ── Left column (flex) ──────────────────────────────────────── */}
          <div className="flex-1 min-w-0 flex flex-col gap-5">
            {/* KPI tile grid */}
            <div className="grid grid-cols-4 gap-4">
              {KPI_TILES.map((kpi) => {
                const Icon = kpi.icon;
                const variantClass =
                  kpi.variant === "critical"
                    ? "kpi-accent kpi-critical"
                    : kpi.variant === "ok"
                      ? "kpi-accent kpi-ok"
                      : "kpi-accent";

                return (
                  <Card
                    key={kpi.label}
                    className={`${variantClass} card-hover relative`}
                  >
                    <CardContent className="p-3">
                      {/* KPI icon badge (top-right) */}
                      <div
                        className="absolute top-2.5 right-2.5 w-7 h-7 rounded-lg flex items-center justify-center text-white"
                        style={{
                          background:
                            kpi.variant === "critical"
                              ? "#b6623d"
                              : kpi.variant === "ok"
                                ? "#2d8a5f"
                                : "var(--color-brand-500)",
                          boxShadow:
                            kpi.variant === "critical"
                              ? "0 4px 10px -4px rgba(182,98,61,.55)"
                              : kpi.variant === "ok"
                                ? "0 4px 10px -4px rgba(45,138,95,.5)"
                                : "0 4px 10px -4px rgba(37,99,168,.6)",
                        }}
                      >
                        <Icon size={14} />
                      </div>

                      <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-3 mb-1">
                        {kpi.label}
                      </div>
                      <div className="text-2xl font-display font-medium tracking-tight text-ink">
                        {kpi.value}
                      </div>
                      <div className="text-[11px] text-ink-4 mt-0.5">
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
                <div className="flex flex-col">
                  {AGENDA.map((item, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 py-2 border-b border-line last:border-b-0"
                    >
                      <span className="text-[11px] font-mono text-ink-4 w-12 shrink-0">
                        {item.time}
                      </span>
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: item.color }}
                      />
                      <span className="text-[12.5px] text-ink">
                        {item.title}
                      </span>
                      <span className="ml-auto text-[10px] font-mono text-ink-4">
                        {item.area}
                      </span>
                    </div>
                  ))}
                </div>
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
                <div className="flex flex-col">
                  {ACTIVITY.map((item, i) => {
                    const Icon = item.icon;
                    return (
                      <div
                        key={i}
                        className="flex items-start gap-3 py-2.5 border-b border-line last:border-b-0"
                      >
                        <div className="w-7 h-7 rounded-md bg-brand-50 flex items-center justify-center shrink-0 mt-0.5">
                          <Icon size={13} className="text-brand-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12.5px] font-medium text-ink">
                            {item.title}
                          </div>
                          <div className="text-[11px] text-ink-3 truncate">
                            {item.detail}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-0.5 shrink-0">
                          <span className="text-[10px] font-mono text-ink-4">
                            {item.time}
                          </span>
                          <span className="text-[9px] font-mono uppercase tracking-wider text-ink-4">
                            {item.source}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ── Right column (340px) ───────────────────────────────────── */}
          <div className="w-[340px] shrink-0 flex flex-col gap-5">
            {/* Deadlines this week */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">
                  Deadlines this week
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="flex flex-col gap-1">
                  {DEADLINES.map((d, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 py-2 border-b border-line last:border-b-0"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-[12.5px] text-ink truncate">
                          {d.title}
                        </div>
                      </div>
                      <span
                        className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded-full ${
                          d.kind === "critical"
                            ? "bg-[#fbf0ea] text-warn border border-[#e2c0ad]"
                            : d.kind === "auto_rule"
                              ? "bg-brand-soft text-brand-700 border border-brand-200"
                              : "bg-paper-2 text-ink-3 border border-line"
                        }`}
                      >
                        {d.days}d
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Firm pulse placeholder */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">
                  Firm pulse
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-ink-3">
                      Billable hours (MTD)
                    </span>
                    <span className="text-[12px] font-mono font-medium text-ink">
                      142.6h
                    </span>
                  </div>
                  <div className="h-1.5 bg-paper-2 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand-500 rounded-full"
                      style={{ width: "71%" }}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-ink-3">
                      Collection rate
                    </span>
                    <span className="text-[12px] font-mono font-medium text-ok">
                      94.2%
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-ink-3">
                      A/R outstanding
                    </span>
                    <span className="text-[12px] font-mono font-medium text-ink">
                      $28,400
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
