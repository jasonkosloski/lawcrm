/**
 * Matters — Kanban view
 *
 * Horizontal pipeline with one column per stage. Stages in the current
 * result set are ordered left-to-right by the smallest `stageOrder`
 * seen for each name, so the default lifecycle reads in order and any
 * area-specific stages slot in based on their configured position.
 *
 * Matters inside a column are already ordered by the page's sort, so
 * changing sort re-orders within columns. Only stages that hold at
 * least one matter in the result get a column (the stage list is not
 * passed in), so a stage with no matches simply has no column.
 *
 * Drag-and-drop to change stage is deferred — this is a read-only
 * visualisation for now.
 */

import Link from "next/link";
import { BILLING_TYPE_LABEL } from "@/lib/billing-type";
import { DueLabel } from "@/components/shared/due-label";
import { formatMoney } from "@/lib/format-money";
import type { MatterListRow } from "@/lib/queries/matters";

export function MattersKanban({
  matters,
  showTrust = true,
}: {
  matters: MatterListRow[];
  /** False without billing.view: trust balances are omitted. */
  showTrust?: boolean;
}) {
  // Group by stage name, tracking the smallest order seen per name so
  // columns read in lifecycle order even when multiple practice areas
  // contribute the same stage name.
  const byStage = new Map<string, MatterListRow[]>();
  const stageOrder = new Map<string, number>();
  for (const m of matters) {
    if (!byStage.has(m.stage)) byStage.set(m.stage, []);
    byStage.get(m.stage)!.push(m);
    const existing = stageOrder.get(m.stage);
    if (existing === undefined || m.stageOrder < existing) {
      stageOrder.set(m.stage, m.stageOrder);
    }
  }

  const stages = [...byStage.keys()].sort((a, b) => {
    const ao = stageOrder.get(a) ?? 999;
    const bo = stageOrder.get(b) ?? 999;
    return ao - bo || a.localeCompare(b);
  });

  // When the filter produces no results at all, show a single empty-state row.
  if (matters.length === 0) {
    return (
      <div className="border border-line rounded-lg py-12 text-center text-xs text-ink-4 bg-white">
        No matters match these filters.
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2 -mx-3 px-3 sm:-mx-6 sm:px-6">
      {stages.map((stage) => {
        const rows = byStage.get(stage) ?? [];
        return (
          <section
            key={stage}
            className="flex flex-col w-72 shrink-0 rounded-lg border border-line bg-paper-2/40"
          >
            <header className="flex items-center justify-between px-3 py-2 border-b border-line">
              <h2 className="text-xs font-semibold text-ink">{stage}</h2>
              <span className="text-2xs font-mono text-ink-4">{rows.length}</span>
            </header>
            <div className="flex flex-col gap-2 p-2 min-h-20">
              {rows.map((m) => (
                <KanbanCard key={m.id} matter={m} showTrust={showTrust} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function KanbanCard({ matter, showTrust }: { matter: MatterListRow; showTrust: boolean }) {
  return (
    <Link
      href={`/matters/${matter.id}`}
      className="flex flex-col gap-1.5 p-2.5 rounded-md bg-white border border-line hover:border-ink-5 transition-colors"
    >
      <div className="flex items-start gap-2">
        <span
          className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
          style={{ background: matter.color }}
        />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-ink leading-snug">{matter.name}</div>
          {matter.caseNumber && (
            <div className="text-2xs font-mono text-ink-4 mt-0.5">{matter.caseNumber}</div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 text-2xs text-ink-3">
        <span>{matter.area}</span>
        <span className="text-ink-4">·</span>
        <span>{BILLING_TYPE_LABEL[matter.billingType]}</span>
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
          {showTrust && (
            <span
              className={
                "font-mono text-2xs " +
                (!matter.trustBalance
                  ? "text-ink-4"
                  : matter.trustBalance < 0
                    ? "text-danger"
                    : "text-ink-3")
              }
            >
              {formatMoney(matter.trustBalance ?? 0)}
            </span>
          )}
        </div>
        {matter.nextDeadlineDays === null ? (
          <span className="text-2xs text-ink-4">—</span>
        ) : (
          <DueLabel dueDate={matter.nextDeadlineDate} days={matter.nextDeadlineDays} />
        )}
      </div>
    </Link>
  );
}
