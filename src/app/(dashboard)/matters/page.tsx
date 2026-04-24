/**
 * Matters List Page
 *
 * Sortable/filterable table of all matters with stage, area, lead,
 * trust balance, and next-deadline columns. Framework version — real
 * filter/sort controls and view toggles (Kanban, Cards) come later.
 */

import Link from "next/link";
import { TopBar } from "@/components/layout/topbar";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listMatters } from "@/lib/queries/matters";

const FEE_LABEL: Record<string, string> = {
  contingent: "contingent",
  hourly: "hourly",
  flat: "flat",
  hybrid: "hybrid",
  pro_bono: "pro bono",
};

const formatMoney = (n: number): string =>
  n === 0 ? "$0" : `$${n.toLocaleString("en-US")}`;

export default async function MattersListPage() {
  const matters = await listMatters();
  const openCount = matters.filter(
    (m) => !m.isArchived && m.stage !== "Closed"
  ).length;
  const closedCount = matters.length - openCount;

  return (
    <>
      <TopBar
        title="All matters"
        crumbs={`${openCount} open · ${closedCount} closed`}
      />

      <div className="flex-1 overflow-y-auto p-5 animate-page-enter">
        <Card className="p-0 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Matter</TableHead>
                <TableHead>Area</TableHead>
                <TableHead>Lead</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Trust</TableHead>
                <TableHead>Fee</TableHead>
                <TableHead className="text-right pr-4">Next deadline</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matters.map((m) => (
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
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand-50 text-2xs font-mono font-medium text-brand-700 border border-brand-100">
                        {m.leadInitials}
                      </span>
                    ) : (
                      <span className="text-2xs text-ink-4">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StageChip stage={m.stage} />
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-ink">
                    {formatMoney(m.trustBalance)}
                  </TableCell>
                  <TableCell className="text-xs text-ink-3">
                    {FEE_LABEL[m.feeStructure] ?? m.feeStructure}
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
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    </>
  );
}

/** Stage chip with stage-specific color tint. */
function StageChip({ stage }: { stage: string }) {
  const active = !["Closed", "Settled"].includes(stage);
  return (
    <span
      className={
        "inline-block text-2xs font-medium px-2 py-0.5 rounded-full border " +
        (active
          ? "bg-brand-soft text-brand-700 border-brand-200"
          : "bg-paper-2 text-ink-3 border-line")
      }
    >
      {stage}
    </span>
  );
}
