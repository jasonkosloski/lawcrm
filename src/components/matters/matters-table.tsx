/**
 * Matters — Table view
 *
 * Dense row-per-matter layout with sortable column headers. The default
 * view when users hit /matters.
 */

import Link from "next/link";
import { Card } from "@/components/ui/card";
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
    <Card className="p-0 overflow-hidden">
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
              <TableCell
                colSpan={7}
                className="py-12 text-center text-xs text-ink-4"
              >
                No matters match these filters.
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
