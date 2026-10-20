/**
 * Per-request session reader.
 *
 * Resolving the Clerk identity to a firm `User` costs DB reads (and a
 * Clerk API call on first sign-in), so everything that just needs
 * "the session" calls this instead: React `cache()` makes the first
 * call do the work and the rest of the same server render share the
 * result. `getStaffAuth` is itself cached; this adapts it to the
 * `{ user: { id } }` shape callers expect.
 *
 * Returns null unless the identity maps to an active firm user.
 * Callers that must tell "signed out" from "no firm access" (the
 * guards, the dashboard layout) use `getStaffAuth` directly.
 */

import { cache } from "react";
import { getStaffAuth } from "@/lib/staff-auth";

export const getSession = cache(async () => {
  const a = await getStaffAuth();
  return a.status === "ok" ? { user: { id: a.userId } } : null;
});
