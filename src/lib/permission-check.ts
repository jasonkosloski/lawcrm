/**
 * Permission runtime checks — server-only.
 *
 * Bridge between the static catalog (`src/lib/permissions.ts`)
 * and Authority decisions in server actions + page guards.
 *
 * Resolution rules:
 *   1. Admin role short-circuits to "all granted." Admin's column
 *      in the matrix is locked + checked, no `RolePermission` rows
 *      are materialized for it; the runtime treats role.name=
 *      "Admin" as a wildcard. Same shape `requireAdmin()` always
 *      had — admin remains a first-class concept.
 *   2. Non-admin: a permission is granted when ANY role the user
 *      holds has a `RolePermission` row for that key. Rolls are
 *      additive — a user holding two roles gets the union of their
 *      permissions.
 *   3. Inactive users can't be granted anything.
 *
 * Caching: `cache()` from React dedupes the role-set fetch across
 * a single request. Multiple gates fired during the same render
 * (page + a server action it triggers) hit the DB once.
 *
 * Backward compat: `requireAdmin()` and `isCurrentUserAdmin()` in
 * `lib/firm.ts` stay — they're the right tool when the gate is
 * conceptually "admin-only" rather than a specific permission
 * (e.g., the future Matter Actions menu's archive/delete). Most
 * gates that read like "this person should be allowed to X" should
 * use `requirePermission` / `currentUserHasPermission` instead.
 */

import { cache } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { ADMIN_ROLE_NAME } from "@/lib/role-constants";

type ResolvedPermissions = {
  /** True when the user holds the Admin role — short-circuits every
   *  permission check to true. */
  isAdmin: boolean;
  /** Set of permission keys explicitly granted via RolePermission
   *  rows on any role the user holds. Empty for admins (we don't
   *  bother materializing the catalog for them). */
  granted: Set<string>;
};

/**
 * Pulls a user's roles + their granted permissions in one query.
 * Cached per-request (keyed by user id) so concurrent checks don't
 * re-fetch.
 */
const resolveUserPermissions = cache(
  async (userId: string): Promise<ResolvedPermissions> => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        isActive: true,
        userRoles: {
          select: {
            role: {
              select: {
                name: true,
                permissions: { select: { permission: true } },
              },
            },
          },
        },
      },
    });
    if (!user || !user.isActive) {
      return { isAdmin: false, granted: new Set<string>() };
    }
    const granted = new Set<string>();
    let isAdmin = false;
    for (const ur of user.userRoles) {
      if (ur.role.name === ADMIN_ROLE_NAME) {
        isAdmin = true;
        continue; // admin gets all — don't bother accumulating
      }
      for (const rp of ur.role.permissions) {
        granted.add(rp.permission);
      }
    }
    return { isAdmin, granted };
  }
);

const resolveCurrentUserPermissions = async (): Promise<ResolvedPermissions> =>
  resolveUserPermissions(await getCurrentUserId());

/**
 * True when the GIVEN user has `permission`. For callers that already
 * hold a verified user id and must not resolve the session again
 * (route handlers the Clerk middleware does not cover, where
 * `getCurrentUserId()` would throw). Admins always do.
 */
export async function userHasPermission(
  userId: string,
  permission: string
): Promise<boolean> {
  const { isAdmin, granted } = await resolveUserPermissions(userId);
  return isAdmin || granted.has(permission);
}

/** True when the current user has `permission`. Admins always do. */
export async function currentUserHasPermission(
  permission: string
): Promise<boolean> {
  const { isAdmin, granted } = await resolveCurrentUserPermissions();
  return isAdmin || granted.has(permission);
}

/** True when the current user has at least one of `permissions`.
 *  Useful for "show this section if the user can do anything in it"
 *  navigation gates. */
export async function currentUserHasAnyPermission(
  permissions: readonly string[]
): Promise<boolean> {
  const { isAdmin, granted } = await resolveCurrentUserPermissions();
  if (isAdmin) return true;
  for (const key of permissions) {
    if (granted.has(key)) return true;
  }
  return false;
}

/** The current user's resolved permissions. Callers MUST branch on
 *  `isAdmin` before consulting `granted` — for admins `granted` is
 *  empty (we never materialize the catalog for them), so
 *  `granted.has(key)` alone silently denies admins everything.
 *  There is no "*" sentinel. */
export async function getCurrentUserPermissions(): Promise<{
  isAdmin: boolean;
  granted: Set<string>;
}> {
  return resolveCurrentUserPermissions();
}

/** Multi-key server-action guard. Requires EVERY key in `permissions`
 *  (an empty list passes). Resolves the user's grants once, then
 *  bounces to the dashboard on the first missing key — before the
 *  caller has written anything. Used by actions that create several
 *  record kinds in one request (note/primary captures), where each
 *  kind must clear its own create gate. Admin always passes. Returns
 *  the userId like `requirePermission`. */
export async function requirePermissions(
  permissions: Iterable<string>
): Promise<string> {
  const userId = await getCurrentUserId();
  const { isAdmin, granted } = await resolveCurrentUserPermissions();
  if (!isAdmin) {
    for (const key of permissions) {
      if (!granted.has(key)) redirect("/");
    }
  }
  return userId;
}

/** Server-action guard. Bounces users without `permission` to the
 *  dashboard. Admin always passes. Returns the userId for chaining
 *  into the action body, mirroring `requireAdmin()`. */
export async function requirePermission(
  permission: string
): Promise<string> {
  const userId = await getCurrentUserId();
  const ok = await currentUserHasPermission(permission);
  if (!ok) {
    // Same redirect target + reasoning as requireAdmin: stay
    // consistent with the existing "you don't belong here" UX
    // rather than introducing a new 403 surface.
    redirect("/");
  }
  return userId;
}

/** Message returned by `requirePermissionResult` on denial. */
export const PERMISSION_DENIED_MESSAGE =
  "You do not have permission to do that.";

/**
 * Non-redirecting twin of `requirePermission` for actions whose
 * caller is an inline component (form, toggle, menu item) that can
 * render a message: denial comes back as a value instead of a
 * navigation to the dashboard, so the user sees WHY nothing
 * happened. Still redirects to /login when there is no session
 * (delegated to getCurrentUserId). Page-level gates and actions
 * that depend on the redirect keep using `requirePermission`.
 */
export async function requirePermissionResult(
  permission: string
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const userId = await getCurrentUserId();
  const ok = await currentUserHasPermission(permission);
  if (!ok) return { ok: false, error: PERMISSION_DENIED_MESSAGE };
  return { ok: true, userId };
}
