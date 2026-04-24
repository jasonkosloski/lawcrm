/**
 * Matters — Kanban view
 *
 * Horizontal pipeline with one column per stage. Columns follow the
 * canonical case-lifecycle order (STAGE_ORDER); any stages present in
 * the data that aren't in the canonical list are appended at the end.
 *
 * Matters inside a column are already ordered by the page's sort, so
 * changing sort re-orders within columns. Empty columns render with a
 * subtle "no matters" placeholder so the pipeline structure stays
 * legible.
 *
 * Drag-and-drop to change stage is deferred — this is a read-only
 * visualisation for now.
 */

import Link from "next/link";
import { STAGE_ORDER, FEE_LABELS } from "@/lib/matters-filters";
import type { MatterListRow } from "@/lib/queries/matters";

const formatMoney = (n: number): string =>
  n === 0 ? "$0" : `$${n.toLocaleString("en-US")}`;

export function MattersKanban({ matters }: { matters: MatterListRow[] }) {
  // Group by stage, preserving canonical order + appending unknowns.
  const byStage = new Map<string, MatterListRow[]>();
  for (const m of matters) {
    if (!byStage.has(m.stage)) byStage.set(m.stage, []);
    byStage.get(m.stage)!.push(m);
  }

  // Always show all canonical lifecycle stages so the pipeline structure
  // stays visible even when some stages are empty. Non-canonical stages
  // from the data get appended at the end.
  const stages = [
    ...STAGE_ORDER,
    ...[...byStage.keys()].filter(
      (s) => !(STAGE_ORDER as readonly string[]).includes(s)
    ),
  ];

  // When the filter produces no results at all, show a single empty-state row.
  if (matters.length === 0) {
    return (
      <div className="border border-line rounded-lg py-12 text-center text-xs text-ink-4 bg-white">
        No matters match these filters.
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2 -mx-5 px-5">
      {stages.map((stage) => {
        const rows = byStage.get(stage) ?? [];
        return (
          <section
            key={stage}
            className="flex flex-col w-72 shrink-0 rounded-lg border border-line bg-paper-2/40"
          >
            <header className="flex items-center justify-between px-3 py-2 border-b border-line">
              <h2 className="text-xs font-semibold text-ink">{stage}</h2>
              <span className="text-2xs font-mono text-ink-4">
                {rows.length}
              </span>
            </header>
            <div className="flex flex-col gap-2 p-2 min-h-20">
              {rows.length === 0 ? (
                <div className="text-2xs text-ink-4 italic text-center py-4">
                  No matters
                </div>
              ) : (
                rows.map((m) => <KanbanCard key={m.id} matter={m} />)
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function KanbanCard({ matter }: { matter: MatterListRow }) {
  return (
    <Link
      href={`/matters/${matter.id}`}
      className="flex flex-col gap-1.5 p-2.5 rounded-md bg-white border border-line hover:border-brand-300 hover:shadow-[0_2px_6px_-2px_rgba(37,99,168,0.2)] transition-all"
    >
      <div className="flex items-start gap-2">
        <span
          className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
          style={{ background: matter.color }}
        />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-ink leading-snug">
            {matter.name}
          </div>
          {matter.caseNumber && (
            <div className="text-2xs font-mono text-ink-4 mt-0.5">
              {matter.caseNumber}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 text-2xs text-ink-3">
        <span>{matter.area}</span>
        <span className="text-ink-4">·</span>
        <span>{FEE_LABELS[matter.feeStructure] ?? matter.feeStructure}</span>
      </div>

      <div className="flex items-center gap-2 justify-between pt-1 border-t border-line">
        <div className="flex items-center gap-2">
          {matter.leadInitials && (
            <span
              className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand-50 text-2xs font-mono font-medium text-brand-700 border border-brand-100"
              title={matter.leadName ?? undefined}
            >
              {matter.leadInitials}
            </span>
          )}
          <span className="font-mono text-2xs text-ink-3">
            {formatMoney(matter.trustBalance)}
          </span>
        </div>
        <span className="font-mono text-2xs">
          {matter.nextDeadlineDays === null ? (
            <span className="text-ink-4">—</span>
          ) : matter.nextDeadlineDays <= 7 ? (
            <span className="text-warn font-medium">
              {matter.nextDeadlineDays}d
            </span>
          ) : (
            <span className="text-ink-3">{matter.nextDeadlineDays}d</span>
          )}
        </span>
      </div>
    </Link>
  );
}
