/**
 * Reports Page — firm-wide reporting dashboard.
 *
 * Four sections, each its own card (components in
 * src/components/reports/):
 *   - Pipeline     — intake leads by stage + open matters by
 *                    practice area × stage + quarter conversions
 *   - Utilization  — per-user hours this month vs firm goals
 *   - AR aging     — outstanding client invoices in 30-day buckets
 *   - Realization  — trailing 3 months worked → billed → collected
 *
 * v1 is server-rendered SNAPSHOTS — every visit recomputes live
 * from Prisma, fixed windows (this month / this quarter / trailing
 * 3 months), no date-range picker yet. The picker (plus export and
 * per-user drill-down) is the noted follow-up for this area.
 *
 * Gated on `reports.view` — page-level guard mirroring
 * /settings/activity's firm.view_activity gate: the sidebar hides
 * the nav item for users without it, but a deep-link still bounces
 * here.
 */

import { redirect } from "next/navigation";
import { TopBar } from "@/components/layout/topbar";
import { currentUserHasPermission } from "@/lib/permission-check";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import {
  getArAgingReport,
  getPipelineReport,
  getRealizationReport,
  getUtilizationReport,
} from "@/lib/queries/reports";
import { PipelineCard } from "@/components/reports/pipeline-card";
import { UtilizationCard } from "@/components/reports/utilization-card";
import { ArAgingCard } from "@/components/reports/ar-aging-card";
import { RealizationCard } from "@/components/reports/realization-card";

export default async function ReportsPage() {
  // Page-level gate. Same shape as /settings/activity.
  const ok = await currentUserHasPermission("reports.view");
  if (!ok) redirect("/");

  // Every windowed query anchors to the VIEWER's calendar — resolve
  // the zone once, then fan out (same pattern as the dashboard).
  const tz = await getCurrentUserTimeZone();
  const [pipeline, utilization, arAging, realization] = await Promise.all([
    getPipelineReport(tz),
    getUtilizationReport(tz),
    getArAgingReport(),
    getRealizationReport(tz),
  ]);

  return (
    <>
      <TopBar title="Reports" crumbs="Reports · live snapshot" />
      <div className="flex-1 overflow-y-auto p-3 sm:p-5 animate-page-enter">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 max-w-6xl">
          <PipelineCard report={pipeline} />
          <UtilizationCard report={utilization} />
          <ArAgingCard report={arAging} />
          <RealizationCard months={realization} />
        </div>
      </div>
    </>
  );
}
