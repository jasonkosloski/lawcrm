/**
 * Matters List Page
 *
 * Server component. Reads filter + sort + view state from the URL,
 * runs a filtered Prisma query, and renders either the table or
 * kanban view. The toolbar (client) updates the URL; Next.js
 * re-renders this page on each change.
 *
 * Next.js 16: `searchParams` is a Promise that must be awaited.
 */

import Link from "next/link";
import { Plus } from "lucide-react";
import { TopBar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { MattersToolbar } from "@/components/matters/matters-toolbar";
import { MattersTable } from "@/components/matters/matters-table";
import { MattersKanban } from "@/components/matters/matters-kanban";
import { prisma } from "@/lib/prisma";
import { parseMattersParams } from "@/lib/matters-filters";
import {
  getMattersFilterOptions,
  listMatters,
} from "@/lib/queries/matters";

export default async function MattersListPage({
  searchParams,
}: PageProps<"/matters">) {
  const sp = await searchParams;
  const { filter, sort, view } = parseMattersParams(sp);

  // Started outside Promise.all so the totalCount branch below can
  // reuse the same promise instead of re-running the heavy list query.
  const mattersPromise = listMatters(filter, sort);

  const [matters, options, totalCount, firmOpenCount, firmClosedCount] =
    await Promise.all([
      mattersPromise,
      getMattersFilterOptions(),
      // Denominator for "showing N of M" — the current filter minus the
      // search term, so it honors every non-search filter (area, stage,
      // fee, lead, archived default). Text search is the only filter
      // listMatters applies in memory, so with no `q` the list result
      // already IS the total — only a live search pays for the second
      // query. (A prisma count would be cheaper still, but needs the
      // where-builder exported from queries/matters.)
      filter.q
        ? listMatters({ ...filter, q: "" }).then((r) => r.length)
        : mattersPromise.then((r) => r.length),
      // Firm-wide counts for the crumb — independent of the user's
      // current filter so the header keeps its reference point even
      // with show-closed off.
      prisma.matter.count({
        where: { isArchived: false, stage: { isTerminal: false } },
      }),
      prisma.matter.count({
        where: { isArchived: false, stage: { isTerminal: true } },
      }),
    ]);

  return (
    <>
      <TopBar
        title="All matters"
        crumbs={`${firmOpenCount} open · ${firmClosedCount} closed/settled`}
        actions={
          <Button
            size="sm"
            render={<Link href="/matters/new" />}
          >
            <Plus />
            New matter
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-3 sm:p-5 animate-page-enter flex flex-col gap-4">
        <MattersToolbar
          filter={filter}
          options={options}
          view={view}
          visibleCount={matters.length}
          totalCount={totalCount}
        />

        {view === "kanban" ? (
          <MattersKanban matters={matters} />
        ) : (
          <MattersTable matters={matters} />
        )}
      </div>
    </>
  );
}
