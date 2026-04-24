/**
 * Matters List Page
 *
 * Server component. Reads the filter + sort state from the URL, runs
 * a filtered Prisma query, and renders the table. The toolbar (client)
 * updates the URL; Next.js re-renders this page on each change.
 *
 * Next.js 16: `searchParams` is a Promise that must be awaited.
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
import { MattersToolbar } from "@/components/matters/matters-toolbar";
import { SortableHeader } from "@/components/matters/sortable-header";
import { parseMattersParams, FEE_LABELS } from "@/lib/matters-filters";
import {
  getMattersFilterOptions,
  listMatters,
} from "@/lib/queries/matters";

const formatMoney = (n: number): string =>
  n === 0 ? "$0" : `$${n.toLocaleString("en-US")}`;

export default async function MattersListPage({
  searchParams,
}: PageProps<"/matters">) {
  const sp = await searchParams;
  const { filter, sort } = parseMattersParams(sp);

  const [matters, options, totalCount] = await Promise.all([
    listMatters(filter, sort),
    getMattersFilterOptions(),
    // Total (unfiltered) count for "showing N of M" — honors only the
    // archived default so the denominator matches the default view.
    listMatters({ ...filter, q: "" /* ignore search for total */ }, sort).then(
      (r) => r.length
    ),
  ]);

  const openCount = matters.filter(
    (m) => !m.isArchived && m.stage !== "Closed" && m.stage !== "Settled"
  ).length;
  const closedOrArchived = matters.length - openCount;

  return (
    <>
      <TopBar
        title="All matters"
        crumbs={`${openCount} open · ${closedOrArchived} closed/settled`}
      />

      <div className="flex-1 overflow-y-auto p-5 animate-page-enter flex flex-col gap-4">
        <MattersToolbar
          filter={filter}
          options={options}
          visibleCount={matters.length}
          totalCount={totalCount}
        />

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
                    <TableCell className="text-xs text-ink-3">
                      {m.area}
                    </TableCell>
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
                      <StageChip stage={m.stage} />
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
