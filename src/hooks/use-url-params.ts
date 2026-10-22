/**
 * URL query-param writer for URL-state controls (filters, sort, view).
 *
 * `useSearchParams()` reflects the COMMITTED router URL, which only
 * updates once a `router.replace` transition finishes, and Next discards
 * a pending navigation when a newer one starts. Building each next URL
 * from the committed params therefore makes rapid successive changes
 * overwrite each other (check "§1983", then "Housing" before the first
 * round trip returns -> only "Housing" survives).
 *
 * `setParams(mutate)` builds from the params of the most recent write
 * still in flight (when there is one), so back-to-back writes compose.
 * The in-flight value is dropped once the URL commits or the transition
 * settles, so back/forward and link navigation never leave a stale base.
 * `mutate` receives that base, so callers can branch on the latest state
 * (e.g. a sort header's asc -> desc -> clear cycle).
 *
 * Every write drops `?page=` (src/lib/pagination.ts): a changed filter,
 * sort or view is a new result, which starts on page 1.
 */

"use client";

import { useCallback, useEffect, useRef, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function useUrlParams() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const committed = searchParams.toString();
  // The committed string, readable from stable callbacks (e.g. a
  // debounce timer) without re-creating them. Written in an effect.
  const committedRef = useRef(committed);
  // The query string of the newest navigation we started that has not
  // committed yet.
  const inFlight = useRef<string | null>(null);

  useEffect(() => {
    committedRef.current = committed;
    // Our navigation landed (or the user navigated elsewhere and nothing
    // of ours is still pending): the committed URL is the truth again.
    if (inFlight.current === committed || !pending) inFlight.current = null;
  }, [committed, pending]);

  const setParams = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const next = new URLSearchParams(inFlight.current ?? committedRef.current);
      next.delete("page");
      mutate(next);
      const query = next.toString();
      inFlight.current = query;
      startTransition(() => {
        router.replace(`?${query}`, { scroll: false });
      });
    },
    [router],
  );

  return { searchParams, setParams, pending };
}
