/**
 * Current User
 *
 * Single resolver for "who is the current user" across all server
 * queries and actions. Resolves the Clerk identity to a firm user
 * (`getStaffAuth`) — every caller stays the same since the function
 * signature is unchanged.
 *
 * Behavior:
 *   - Logged in → returns the session user id.
 *   - Signed in without firm access → redirect to `/no-access`.
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
import { getSession } from "@/lib/session";
import { getStaffAuth } from "@/lib/staff-auth";

// Re-exported so existing importers of `getSession` from here keep working;
// the per-request memoised reader lives in `@/lib/session`.
export { getSession };

/**
 * Cached per-request (via `getSession`): this function is called
 * several times per request (a single `requirePermission` gate hits it
 * twice: once directly, once inside the permission resolver).
 */
export const getCurrentUserId = cache(async (): Promise<string> => {
  const staff = await getStaffAuth();
  if (staff.status === "no_access") {
    // Signed in with Clerk but not a firm member (or deactivated).
    // Throws — no return value.
    redirect("/no-access");
  }
  if (staff.status !== "ok") {
    // Anything past this point would dereference a missing user, so
    // bounce to login. This throws — no return value.
    redirect("/login");
  }
  return staff.userId;
});

/**
 * Page / layout auth guard. Call as the FIRST statement of every
 * `page.tsx` and `layout.tsx` (before any data read): Next renders a
 * page without re-running its parent layouts on partial (RSC)
 * navigations, and the proxy only checks that a session cookie is
 * present, so a layout is not an auth gate. Redirects to `/login`
 * when there is no valid session, or to `/no-access` when the Clerk
 * user has no firm access (throws NEXT_REDIRECT — never wrap
 * it in try/catch). Returns the user id for convenience. Cached via
 * `getCurrentUserId`, so repeat calls in one request are free.
 *
 * `src/app/page-guards.test.ts` statically enforces that every page
 * calls a guard.
 */
export async function requireUser(): Promise<string> {
  return getCurrentUserId();
}
