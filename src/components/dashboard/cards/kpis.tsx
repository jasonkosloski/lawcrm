import { StatStrip, type Stat } from "@/components/shared/stat-strip";
import type { DashboardKpis } from "@/lib/queries/dashboard";
import { formatMoney } from "@/lib/format-money";

export function KpisCard({ kpis }: { kpis: DashboardKpis }) {
  const stats: Stat[] = [
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
    // Firm-wide trust total: null (cell omitted) without reports.view and billing.view.
    ...(kpis.trustBalance !== null
      ? [
          {
            label: "Trust balance",
            value: formatMoney(kpis.trustBalance, { cents: false }),
            detail: `Across ${kpis.trustMatterCount ?? 0} matters`,
          },
        ]
      : []),
  ];

  return <StatStrip stats={stats} />;
}
