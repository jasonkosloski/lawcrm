/**
 * Reports — Pipeline card.
 *
 * Two stacked views of "what's coming in":
 *   1. Intake funnel — active leads per stage, horizontal CSS bars
 *      (same idiom as the /time week view — no charting library).
 *   2. Open matters by practice area × stage — per-area rows with
 *      stage chips, colored by the area's settings color.
 *
 * Server component, read-only. Data shape from
 * `getPipelineReport` in src/lib/queries/reports.ts.
 */

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PipelineReport } from "@/lib/queries/reports";

export function PipelineCard({ report }: { report: PipelineReport }) {
  // Scale bars against the busiest stage, floored at 1 so an empty
  // pipeline doesn't divide by zero.
  const leadScale = Math.max(1, ...report.leadsByStage.map((s) => s.count));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          Pipeline
          <span className="text-2xs font-mono font-normal text-ink-4">
            {report.totalActiveLeads} leads · {report.totalOpenMatters} open
            matters
          </span>
          <span className="ml-auto text-2xs font-mono font-medium px-2 py-0.5 rounded-full bg-ok-soft text-ok border border-line">
            {report.convertedThisQuarter} converted this quarter
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 flex flex-col gap-4">
        {/* Intake funnel */}
        <div className="flex flex-col gap-1.5">
          <div className="text-2xs font-semibold uppercase tracking-wider text-ink-4">
            Intake queue
          </div>
          {report.totalActiveLeads === 0 ? (
            <div className="py-2 text-xs text-ink-4">
              No active leads in the queue.
            </div>
          ) : (
            report.leadsByStage.map((s) => (
              <div key={s.stage} className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-2xs text-ink-3">
                  {s.label}
                </span>
                <div className="flex-1 h-1.5 bg-paper-2 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand-500 rounded-full"
                    style={{ width: `${(s.count / leadScale) * 100}%` }}
                  />
                </div>
                <span className="w-6 shrink-0 text-right text-2xs font-mono text-ink">
                  {s.count}
                </span>
              </div>
            ))
          )}
        </div>

        {/* Open matters by area × stage */}
        <div className="flex flex-col gap-2">
          <div className="text-2xs font-semibold uppercase tracking-wider text-ink-4">
            Open matters by practice area
          </div>
          {report.areas.length === 0 ? (
            <div className="py-2 text-xs text-ink-4">No open matters.</div>
          ) : (
            report.areas.map((area) => (
              <div
                key={area.areaId}
                className="flex flex-col gap-1 py-1.5 border-b border-line/60 last:border-b-0"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: area.color }}
                  />
                  <Link
                    href={`/matters?area=${encodeURIComponent(area.name)}`}
                    className="text-xs text-ink hover:text-brand-700 hover:underline"
                  >
                    {area.label}
                  </Link>
                  <span className="ml-auto text-2xs font-mono text-ink-3">
                    {area.total}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1 pl-3.5">
                  {area.stages.map((s) => (
                    <span
                      key={s.stageId}
                      className="inline-flex items-center gap-1 px-1.5 py-px rounded-full border border-line bg-white text-2xs text-ink-2"
                    >
                      {s.name}
                      <span className="font-mono text-ink-4">{s.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
