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
  LIST_MATTERS_SCAN_LIMIT,
} from "@/lib/queries/matters";
import { hrefFromSearchParams, parsePageParam } from "@/lib/pagination";
import { Pager, TruncationNotice } from "@/components/shared/pager";
import { requireUser } from "@/lib/current-user";
import { matterAccessWhere } from "@/lib/matter-access";
import { currentUserHasPermission } from "@/lib/permission-check";

export default async function MattersListPage({
  searchParams,
}: PageProps<"/matters">) {
  const userId = await requireUser();
  const sp = await searchParams;
  const parsed = parseMattersParams(sp);
  // Trust is a billing surface (ADR-038): without billing.view the
  // column, sort and filter are all dropped (the query ignores them
  // too — this just keeps the UI honest).
  const canViewTrust = await currentUserHasPermission("billing.view");
  const { sort, view } = parsed;
  const filter = canViewTrust ? parsed.filter : { ...parsed.filter, trust: "any" as const };
  const access = await matterAccessWhere(userId);

  const [
    matterPage,
    options,
    totalCount,
    firmOpenCount,
    firmClosedCount,
    canCreateMatter,
  ] = await Promise.all([
      listMatters(filter, sort, undefined, undefined, parsePageParam(sp.page)),
      getMattersFilterOptions(userId),
      // Denominator for "showing N of M" — a DB-side count with the
      // exact same filters as listMatters, text search included (both
      // go through one buildWhere). Immune to paging and the scan bound.
      countMatters(filter),
      // Firm-wide counts for the crumb — independent of the user's
      // current filter so the header keeps its reference point even
      // with show-closed off.
      prisma.matter.count({
        where: { ...access, isArchived: false, stage: { isTerminal: false } },
      }),
      prisma.matter.count({
        where: { ...access, isArchived: false, stage: { isTerminal: true } },
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
          showTrust={canViewTrust}
          visibleCount={matterPage.rows.length}
          totalCount={totalCount}
        />

        {matterPage.scanLimited && (
          <TruncationNotice
            shown={LIST_MATTERS_SCAN_LIMIT}
            total={totalCount}
            hint="Only the newest matches are sorted and paged — add a filter or search to reach older matters."
          />
        )}

        {view === "kanban" ? (
          <MattersKanban matters={matterPage.rows} showTrust={canViewTrust} />
        ) : (
          <MattersTable matters={matterPage.rows} showTrust={canViewTrust} />
        )}

        <Pager {...matterPage} href={hrefFromSearchParams("/matters", sp)} />
      </div>
    </>
  );
}
