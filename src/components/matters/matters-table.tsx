/**
 * Matters — Table view
 *
 * Dense row-per-matter layout with sortable column headers. The default
 * view when users hit /matters.
 */

import Link from "next/link";
import { Briefcase } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { SortableHead } from "@/components/matters/sortable-header";
import { BILLING_TYPE_LABEL } from "@/lib/billing-type";
import { DueLabel } from "@/components/shared/due-label";

/** Zero trust reads grey; a shortfall reads danger. */
function trustTone(v: number | null): string {
  if (!v) return "text-ink-4";
  return v < 0 ? "text-danger" : "text-ink";
}
import { formatMoney } from "@/lib/format-money";
import type { MatterListRow } from "@/lib/queries/matters";

export function MattersTable({
  matters,
  showTrust = true,
}: {
  matters: MatterListRow[];
  /** False without billing.view: the trust column is omitted. */
  showTrust?: boolean;
}) {
  return (
    <>
      {/* Mobile + small tablet: card stack. The 7-column table is
          unreadable on a phone — collapse to one card per matter
          showing the most-glanceable bits (name, area, lead,
          stage, trust, deadline). Sortable headers are dropped
          here; sorting is most useful on a desktop scan anyway. */}
      <ul className="md:hidden flex flex-col gap-2">
        {matters.length === 0 ? (
          <li className="rounded border border-line bg-card">
            <EmptyState
              icon={Briefcase}
              title="No matters match"
              description="Try clearing a filter or two."
              className="py-6"
            />
          </li>
        ) : (
          matters.map((m) => <MatterCard key={m.id} m={m} showTrust={showTrust} />)
        )}
      </ul>

      {/* Tablet+ desktop: the dense table. */}
      <Card className="p-0 overflow-hidden hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead field="name" className="pl-4">
                Matter
              </SortableHead>
              <SortableHead field="area">Area</SortableHead>
              <SortableHead field="lead">Lead</SortableHead>
              <SortableHead field="stage">Stage</SortableHead>
              {showTrust && (
                <SortableHead field="trust" align="right" className="text-right">
                  Trust
                </SortableHead>
              )}
              <SortableHead field="fee">Fee</SortableHead>
              <SortableHead field="deadline" align="right" className="text-right pr-4">
                Next deadline
              </SortableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {matters.length === 0 ? (
              <TableRow>
                <TableCell colSpan={showTrust ? 7 : 6} className="p-0">
                  <EmptyState
                    icon={Briefcase}
                    title="No matters match"
                    description="Try clearing a filter or two."
                    className="py-12"
                  />
                </TableCell>
              </TableRow>
            ) : (
              matters.map((m) => (
                // The name link is stretched over the whole row (after:
                // pseudo-element), so the pointer cursor is honest.
                <TableRow key={m.id} className="relative cursor-pointer">
                  <TableCell className="pl-4">
                    <Link
                      href={`/matters/${m.id}`}
                      className="flex items-center gap-2 hover:text-brand-700 after:absolute after:inset-0"
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: m.color }}
                      />
                      <span className="font-medium">{m.name}</span>
                      {m.caseNumber && (
                        <span className="text-2xs font-mono text-ink-4">{m.caseNumber}</span>
                      )}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs text-ink-3">{m.area}</TableCell>
                  <TableCell>
                    {m.leadInitials ? (
                      <span
                        className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand-50 text-2xs font-mono font-medium text-brand-700 border border-brand-100"
                        title={m.leadName ?? undefined}
                      >
                        {m.leadInitials}
                      </span>
                    ) : (
                      <span className="text-2xs text-ink-4">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StageChip stage={m.stage} isTerminal={m.stageIsTerminal} />
                  </TableCell>
                  {showTrust && (
                    <TableCell
                      className={"text-right font-mono text-xs " + trustTone(m.trustBalance)}
                    >
                      {formatMoney(m.trustBalance ?? 0)}
                    </TableCell>
                  )}
                  <TableCell className="text-xs text-ink-3">
                    {BILLING_TYPE_LABEL[m.billingType]}
                  </TableCell>
                  <TableCell className="text-right pr-4">
                    {m.nextDeadlineDays === null ? (
                      <span className="text-ink-4">—</span>
                    ) : (
                      <DueLabel dueDate={m.nextDeadlineDate} days={m.nextDeadlineDays} />
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

function MatterCard({ m, showTrust }: { m: MatterListRow; showTrust: boolean }) {
  return (
    <li>
      <Link
        href={`/matters/${m.id}`}
        className="block rounded border border-line bg-card p-3 hover:border-brand-300 transition-colors"
      >
        <div className="flex items-start gap-2">
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5"
            style={{ background: m.color }}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-ink truncate">{m.name}</span>
              {m.caseNumber && (
                <span className="text-2xs font-mono text-ink-4">{m.caseNumber}</span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap mt-1.5">
              <StageChip stage={m.stage} isTerminal={m.stageIsTerminal} />
              <span className="text-2xs text-ink-3">{m.area}</span>
              {m.leadInitials && (
                <span
                  className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand-50 text-3xs font-mono font-medium text-brand-700 border border-brand-100"
                  title={m.leadName ?? undefined}
                >
                  {m.leadInitials}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {showTrust && (
              <span className={"font-mono text-xs " + trustTone(m.trustBalance)}>
                {formatMoney(m.trustBalance ?? 0)}
              </span>
            )}
            {m.nextDeadlineDays !== null && (
              <DueLabel dueDate={m.nextDeadlineDate} days={m.nextDeadlineDays} />
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}

function StageChip({ stage, isTerminal }: { stage: string; isTerminal: boolean }) {
  return (
    <span
      className={
        "inline-block text-2xs font-medium px-2 py-0.5 rounded-full border " +
        (isTerminal
          ? "bg-paper-2 text-ink-3 border-line"
          : "bg-brand-soft text-brand-700 border-brand-200")
      }
    >
      {stage}
    </span>
  );
}
