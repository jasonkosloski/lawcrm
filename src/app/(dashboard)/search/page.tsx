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
 * Saved searches: a per-user chip strip under the input (rename /
 * delete via kebab) + a save toggle next to the input capturing the
 * current query + ?type= scope. Identity-scoped, no permission key
 * — see src/app/actions/saved-searches.ts.
 *
 * Next.js 16: `searchParams` is a Promise that must be awaited.
 */

import { Search } from "lucide-react";
import { TopBar } from "@/components/layout/topbar";
import { EmptyState } from "@/components/shared/empty-state";
import { SearchForm } from "@/components/search/search-form";
import { SearchResults } from "@/components/search/search-results";
import { SaveSearchButton } from "@/components/search/save-search-button";
import { SavedSearchChips } from "@/components/search/saved-search-chips";
import {
  globalSearch,
  isSearchHitType,
  SEARCH_MIN_QUERY_LENGTH,
  type GlobalSearchResult,
} from "@/lib/queries/search";
import { getSavedSearches } from "@/lib/queries/saved-searches";

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
  const [result, savedSearches] = await Promise.all([
    longEnough
      ? globalSearch(q, expandedType ? { type: expandedType } : undefined)
      : Promise.resolve<GlobalSearchResult>({ query: q, groups: [] }),
    getSavedSearches(),
  ]);
  const totalHits = result.groups.reduce((sum, g) => sum + g.total, 0);

  // Is the active (query, scope) pair already saved? Case-insensitive
  // on the query — matching the search's own case-insensitivity and
  // the create action's dedupe rule.
  const activeSavedId = longEnough
    ? (savedSearches.find(
        (s) => s.q.toLowerCase() === q.toLowerCase() && s.type === expandedType
      )?.id ?? null)
    : null;

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
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <SearchForm initialQuery={q} />
            </div>
            {longEnough && (
              <SaveSearchButton
                query={q}
                type={expandedType}
                savedId={activeSavedId}
              />
            )}
          </div>

          {savedSearches.length > 0 && (
            <SavedSearchChips rows={savedSearches} activeId={activeSavedId} />
          )}

          {q.length === 0 ? (
            <EmptyState
              framed
              icon={Search}
              title="Search everything"
              description="Matters, contacts, leads, notes, documents, tasks, deadlines, events, email, messages, and time entries."
            />
          ) : !longEnough ? (
            <EmptyState
              framed
              icon={Search}
              title="Keep typing"
              description={`Searches need at least ${SEARCH_MIN_QUERY_LENGTH} characters.`}
            />
          ) : result.groups.length === 0 ? (
            <EmptyState
              framed
              icon={Search}
              title={`No results for “${q}”`}
              description="Try fewer or different words — matching is exact-substring for now."
            />
          ) : (
            <SearchResults result={result} expandedType={expandedType} />
          )}
        </div>
      </div>
    </>
  );
}
