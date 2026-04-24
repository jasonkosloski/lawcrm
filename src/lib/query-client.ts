/**
 * TanStack Query Client Configuration
 *
 * Centralized configuration for React Query with sensible defaults for a
 * data-heavy legal CRM — stale times, retry behavior, and refetch policies.
 */

import { QueryClient } from "@tanstack/react-query";

/**
 * Creates a new QueryClient with production-appropriate defaults.
 * Called once per app mount (see QueryProvider).
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        /**
         * Data is considered fresh for 30 seconds. After that, it will be
         * refetched in the background on the next access. This is a good
         * balance for a multi-user CRM where data changes frequently but
         * users don't need sub-second freshness.
         */
        staleTime: 30 * 1000,

        /**
         * Cache query results for 5 minutes after all subscribers unmount.
         * Helps with back-navigation and tab switching without re-fetching.
         */
        gcTime: 5 * 60 * 1000,

        /**
         * Retry failed queries up to 2 times with exponential backoff.
         * Prevents flashing error states on transient network issues.
         */
        retry: 2,

        /**
         * Refetch when the browser window regains focus. Ensures users
         * always see reasonably fresh data when switching between apps.
         */
        refetchOnWindowFocus: true,
      },
      mutations: {
        /** Don't retry mutations — they should fail explicitly. */
        retry: false,
      },
    },
  });
}
