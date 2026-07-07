/**
 * Global search results — /search?q=<query>[&type=<entity>]
 *
 * Content search across every entity type ("which matter mentioned
 * the ambulance report?"), complementing the ⌘K palette's
 * jump-to-entity. Server component: `globalSearch` runs the ILIKE
 * fan-out (src/lib/queries/search.ts) and enforces every read-model
 * guard server-side — calendar visibility scrub, privileged
 * time-entry narratives, merged-contact exclusion.
 *
 * URL-driven: `?q=` is the query (GET form at the top re-submits
 * it), `?type=` expands one group to SEARCH_EXPANDED_TAKE rows.
 *
 * Next.js 16: `searchParams` is a Promise that must be awaited.
 */

import { TopBar } from "@/components/layout/topbar";
import { SearchForm } from "@/components/search/search-form";
import { SearchResults } from "@/components/search/search-results";
import {
  globalSearch,
  isSearchHitType,
  SEARCH_MIN_QUERY_LENGTH,
  type GlobalSearchResult,
} from "@/lib/queries/search";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; type?: string | string[] }>;
}) {
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim() ?? "";
  const rawType = Array.isArray(sp.type) ? sp.type[0] : sp.type;
  const expandedType = isSearchHitType(rawType) ? rawType : null;

  const longEnough = q.length >= SEARCH_MIN_QUERY_LENGTH;
  const result: GlobalSearchResult = longEnough
    ? await globalSearch(q, expandedType ? { type: expandedType } : undefined)
    : { query: q, groups: [] };
  const totalHits = result.groups.reduce((sum, g) => sum + g.total, 0);

  return (
    <>
      <TopBar
        title="Search"
        crumbs={
          longEnough
            ? `Search · ${totalHits} result${totalHits === 1 ? "" : "s"}`
            : "Search"
        }
      />

      <div className="flex-1 overflow-y-auto p-3 sm:p-5 animate-page-enter">
        <div className="max-w-3xl mx-auto flex flex-col gap-4">
          <SearchForm initialQuery={q} />

          {q.length === 0 ? (
            <EmptyState>
              Search everything — matters, contacts, leads, notes, documents,
              tasks, deadlines, events, email, messages, and time entries.
            </EmptyState>
          ) : !longEnough ? (
            <EmptyState>
              Keep typing — searches need at least {SEARCH_MIN_QUERY_LENGTH}{" "}
              characters.
            </EmptyState>
          ) : result.groups.length === 0 ? (
            <EmptyState>
              No results for &ldquo;{q}&rdquo;. Try fewer or different words —
              matching is exact-substring for now.
            </EmptyState>
          ) : (
            <SearchResults result={result} expandedType={expandedType} />
          )}
        </div>
      </div>
    </>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line-2 bg-card px-4 py-8 text-center text-xs text-ink-3">
      {children}
    </div>
  );
}
