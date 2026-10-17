/**
 * Current User
 *
 * Single resolver for "who is the current user" across all server
 * queries and actions. Reads from the Auth.js session — every caller
 * stays the same since the function signature is unchanged.
 *
 * Behavior:
 *   - Logged in → returns the session user id.
 *   - Not logged in → throws a Next.js redirect to `/login`. Pages
 *     and server actions that call this never have to think about
 *     the unauth case; the proxy + this throw cover it twice.
 *
 * Multi-tenant note: when `firmId` lands on the session, expose it
 * here too (e.g. `getCurrentUserContext(): { userId, firmId }`).
 * Existing callers that just need the user id keep using this fn.
 */

import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

/**
 * The request's Auth.js session, decoded ONCE per request.
 *
 * Every `auth()` call runs the full session action: JWE decrypt, the
 * jwt callback's `user.findUnique` (isActive + password fingerprint,
 * ADR-017) and a re-encrypt whose cookie is discarded. `auth()` itself
 * is not memoised, and React `cache()` only dedupes per wrapper, so
 * every server-side reader (layouts, queries, `getCurrentUserId`)
 * should go through this one wrapper. With the pg pool capped at 1
 * connection, redundant round-trips serialize, so deduping matters.
 */
export const getSession = cache(() => auth());

/**
 * Cached per-request (via `getSession`): this function is called
 * several times per request (a single `requirePermission` gate hits it
 * twice: once directly, once inside the permission resolver).
 */
export const getCurrentUserId = cache(async (): Promise<string> => {
  const session = await getSession();
  if (!session?.user?.id) {
    // Anything past this point would dereference a missing user, so
    // bounce to login. This throws — no return value.
    redirect("/login");
  }
  return session.user.id;
});

/**
 * Page / layout auth guard. Call as the FIRST statement of every
 * `page.tsx` and `layout.tsx` (before any data read): Next renders a
 * page without re-running its parent layouts on partial (RSC)
 * navigations, and the proxy only checks that a session cookie is
 * present, so a layout is not an auth gate. Redirects to `/login`
 * when there is no valid session (throws NEXT_REDIRECT — never wrap
 * it in try/catch). Returns the user id for convenience. Cached via
 * `getCurrentUserId`, so repeat calls in one request are free.
 *
 * `src/app/page-guards.test.ts` statically enforces that every page
 * calls a guard.
 */
export async function requireUser(): Promise<string> {
  return getCurrentUserId();
}
