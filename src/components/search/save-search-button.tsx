/**
 * "Save search" toggle — sits next to the query input on /search
 * when a runnable (≥ min-length) query is active.
 *
 * Saves immediately with the query text as the default name
 * (renaming happens from the saved chip's kebab — see
 * ./saved-search-chips.tsx); captures the current ?type= scope.
 * When the active (query, scope) pair is already saved the button
 * flips to a "Saved" state and clicking it un-saves. The server
 * action dedupes on (q, scope), so double-clicks can't stack rows.
 */

"use client";

import { useTransition } from "react";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  createSavedSearch,
  deleteSavedSearch,
} from "@/app/actions/saved-searches";
import type { SearchHitType } from "@/lib/queries/search";

/** Keep in sync with SAVED_SEARCH_NAME_MAX (lib/queries/
 *  saved-searches.ts) — not imported so the prisma-touching query
 *  module stays out of the client bundle. */
const NAME_MAX = 80;

export function SaveSearchButton({
  query,
  type,
  savedId,
}: {
  query: string;
  /** Active ?type= scope, captured onto the saved row. */
  type: SearchHitType | null;
  /** Id of the saved row matching (query, type), when one exists —
   *  flips the button into its "Saved" / un-save state. */
  savedId: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const saved = savedId !== null;

  const onClick = () => {
    startTransition(async () => {
      const res = saved
        ? await deleteSavedSearch(savedId)
        : await createSavedSearch(query.trim().slice(0, NAME_MAX), query, type);
      if (!res.ok) alert(res.error);
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-pressed={saved}
      title={saved ? "Remove from saved searches" : "Save this search"}
      className={cn(
        "inline-flex items-center gap-1.5 h-10 px-3 shrink-0 rounded-md border text-xs transition-colors disabled:opacity-50",
        saved
          ? "border-brand-300 bg-brand-50 text-brand-700 hover:bg-brand-100"
          : "border-line-2 bg-white text-ink-3 hover:text-ink hover:bg-paper-2"
      )}
    >
      {saved ? <BookmarkCheck size={13} /> : <Bookmark size={13} />}
      <span className="hidden sm:inline">
        {saved ? "Saved" : "Save search"}
      </span>
    </button>
  );
}
