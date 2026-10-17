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
  countMatters,
  getMattersFilterOptions,
  listMatters,
} from "@/lib/queries/matters";
import { requireUser } from "@/lib/current-user";
import { currentUserHasPermission } from "@/lib/permission-check";

export default async function MattersListPage({
  searchParams,
}: PageProps<"/matters">) {
  await requireUser();
  const sp = await searchParams;
  const { filter, sort, view } = parseMattersParams(sp);

  const [
    matters,
    options,
    totalCount,
    firmOpenCount,
    firmClosedCount,
    canCreateMatter,
  ] = await Promise.all([
      listMatters(filter, sort),
      getMattersFilterOptions(),
      // Denominator for "showing N of M" — a DB-side count with the
      // exact same filters as listMatters, text search included (both
      // go through one buildWhere). Immune to LIST_MATTERS_CAP.
      countMatters(filter),
      // Firm-wide counts for the crumb — independent of the user's
      // current filter so the header keeps its reference point even
      // with show-closed off.
      prisma.matter.count({
        where: { isArchived: false, stage: { isTerminal: false } },
      }),
      prisma.matter.count({
        where: { isArchived: false, stage: { isTerminal: true } },
      }),
      // Same key createMatter / the New matter page enforce — hide the
      // button instead of offering a form that bounces to "/".
      currentUserHasPermission("matters.create"),
    ]);

  return (
    <>
      <TopBar
        title="All matters"
        crumbs={`${firmOpenCount} open · ${firmClosedCount} closed/settled`}
        actions={
          canCreateMatter ? (
            <Button size="sm" render={<Link href="/matters/new" />}>
              <Plus />
              New matter
            </Button>
          ) : undefined
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
