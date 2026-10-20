import { Briefcase, Clock, DollarSign, Mail, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { DashboardKpis } from "@/lib/queries/dashboard";
import { formatMoney } from "./format";


type KpiTile = {
  label: string;
  value: string;
  change: string;
  icon: LucideIcon;
  variant: "accent" | "critical" | "ok";
  /** 0-100; renders a thin progress bar under the tile when set. */
  progress?: number;
};

/** Percent of goal reached, rounded and capped at 100; 0 for a zero goal. */
const goalPercent = (done: number, goal: number): number =>
  goal <= 0 ? 0 : Math.min(100, Math.round((done / goal) * 100));

export function KpisCard({ kpis }: { kpis: DashboardKpis }) {
  const tiles: KpiTile[] = [
    {
      label: "Open matters",
      value: kpis.openMatters.toString(),
      change: kpis.openMattersChange,
      icon: Briefcase,
      variant: "accent",
    },
    {
      label: "Unread email",
      value: kpis.unreadEmail.toString(),
      change:
        kpis.flaggedEmail > 0
          ? `${kpis.flaggedEmail} starred unread`
          : "none starred",
      icon: Mail,
      variant: kpis.flaggedEmail > 0 ? "critical" : "accent",
    },
    {
      label: "Hours today",
      value: kpis.hoursToday.toFixed(1),
      change: `${kpis.hoursGoal.toFixed(1)} goal`,
      icon: Clock,
      variant: "accent",
      progress: goalPercent(kpis.hoursToday, kpis.hoursGoal),
    },
    // Firm-wide trust total: null (tile omitted) without reports.view and billing.view.
    ...(kpis.trustBalance !== null
      ? [
          {
            label: "Trust balance",
            value: formatMoney(kpis.trustBalance),
            change: `across ${kpis.trustMatterCount ?? 0} matters`,
            icon: DollarSign,
            variant: "ok" as const,
          },
        ]
      : []),
  ];

  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-3 @sm:grid-cols-2 @2xl:grid-cols-4 @sm:gap-4">
        {tiles.map((kpi) => {
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
                  className={`absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-lg text-white ${badgeClass}`}
                >
                  <Icon size={14} />
                </div>
                <div className="mb-1 text-2xs font-semibold uppercase tracking-wider text-ink-3">
                  {kpi.label}
                </div>
                <div className="font-display text-2xl font-medium tracking-tight text-ink">
                  {kpi.value}
                </div>
                <div className="mt-0.5 text-2xs text-ink-4">{kpi.change}</div>
                {kpi.progress !== undefined && (
                  <div
                    role="progressbar"
                    aria-label={kpi.label}
                    aria-valuenow={kpi.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="mt-2 h-1.5 overflow-hidden rounded-full bg-paper-2"
                  >
                    <div
                      className="h-full rounded-full bg-brand-500"
                      style={{ width: `${kpi.progress}%` }}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
