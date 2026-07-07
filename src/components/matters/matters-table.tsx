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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SortableHeader } from "@/components/matters/sortable-header";
import { FEE_LABELS } from "@/lib/matters-filters";
import type { MatterListRow } from "@/lib/queries/matters";

const formatMoney = (n: number): string =>
  n === 0 ? "$0" : `$${n.toLocaleString("en-US")}`;

export function MattersTable({ matters }: { matters: MatterListRow[] }) {
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
          matters.map((m) => <MatterCard key={m.id} m={m} />)
        )}
      </ul>

      {/* Tablet+ desktop: the dense table. */}
      <Card className="p-0 overflow-hidden hidden md:block">
        <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">
              <SortableHeader field="name">Matter</SortableHeader>
            </TableHead>
            <TableHead>
              <SortableHeader field="area">Area</SortableHeader>
            </TableHead>
            <TableHead>
              <SortableHeader field="lead">Lead</SortableHeader>
            </TableHead>
            <TableHead>
              <SortableHeader field="stage">Stage</SortableHeader>
            </TableHead>
            <TableHead className="text-right">
              <SortableHeader field="trust" align="right">
                Trust
              </SortableHeader>
            </TableHead>
            <TableHead>
              <SortableHeader field="fee">Fee</SortableHeader>
            </TableHead>
            <TableHead className="text-right pr-4">
              <SortableHeader field="deadline" align="right">
                Next deadline
              </SortableHeader>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {matters.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="p-0">
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
              <TableRow key={m.id} className="cursor-pointer">
                <TableCell className="pl-4">
                  <Link
                    href={`/matters/${m.id}`}
                    className="flex items-center gap-2 hover:text-brand-700"
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: m.color }}
                    />
                    <span className="font-medium">{m.name}</span>
                    {m.caseNumber && (
                      <span className="text-2xs font-mono text-ink-4">
                        {m.caseNumber}
                      </span>
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
                <TableCell className="text-right font-mono text-xs text-ink">
                  {formatMoney(m.trustBalance)}
                </TableCell>
                <TableCell className="text-xs text-ink-3">
                  {FEE_LABELS[m.feeStructure] ?? m.feeStructure}
                </TableCell>
                <TableCell className="text-right pr-4 font-mono text-2xs">
                  {m.nextDeadlineDays === null ? (
                    <span className="text-ink-4">—</span>
                  ) : m.nextDeadlineDays <= 7 ? (
                    <span className="text-warn font-medium">
                      {m.nextDeadlineDays}d
                    </span>
                  ) : (
                    <span className="text-ink-3">{m.nextDeadlineDays}d</span>
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

function MatterCard({ m }: { m: MatterListRow }) {
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
              <span className="text-sm font-medium text-ink truncate">
                {m.name}
              </span>
              {m.caseNumber && (
                <span className="text-2xs font-mono text-ink-4">
                  {m.caseNumber}
                </span>
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
            <span className="font-mono text-xs text-ink">
              {formatMoney(m.trustBalance)}
            </span>
            {m.nextDeadlineDays !== null && (
              <span
                className={
                  "font-mono text-2xs " +
                  (m.nextDeadlineDays <= 7
                    ? "text-warn font-medium"
                    : "text-ink-3")
                }
              >
                {m.nextDeadlineDays}d
              </span>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}

function StageChip({
  stage,
  isTerminal,
}: {
  stage: string;
  isTerminal: boolean;
}) {
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
