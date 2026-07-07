/**
 * Firm helpers — server-only.
 *
 * Single chokepoint for "which firm does the current user belong to,
 * and are they allowed to administer it?" Multi-tenant friendly: when
 * we add multiple firms, scoping every query off `getCurrentFirm()`
 * is the contract; the session callback just needs to start putting
 * `firmId` on the JWT.
 *
 * Today (single tenant), `getCurrentFirm()` resolves the user → their
 * firm → returns the firm row. Tomorrow it'll read `firmId` directly
 * from the session for free.
 */

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { ADMIN_ROLE_NAME } from "@/lib/role-constants";

// Re-export so server-only callers have one import path. Client
// callers should import directly from "@/lib/role-constants".
export { ADMIN_ROLE_NAME, DEFAULT_ROLE_NAME } from "@/lib/role-constants";

export type FirmProfile = {
  id: string;
  name: string;
  shortName: string | null;
  ein: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string;
  establishedAt: Date | null;
  logoUrl: string | null;
};

/** The current user's firm. Throws via `redirect("/login")` when
 *  the user isn't signed in (delegated to getCurrentUserId).
 *  Throws a plain Error when a signed-in user has no firm — that's
 *  a data integrity bug, not a normal flow. */
export async function getCurrentFirm(): Promise<FirmProfile> {
  const userId = await getCurrentUserId();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      firm: {
        select: {
          id: true,
          name: true,
          shortName: true,
          ein: true,
          website: true,
          phone: true,
          email: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
          zip: true,
          country: true,
          establishedAt: true,
          logoUrl: true,
        },
      },
    },
  });
  if (!user?.firm) {
    // A signed-in user with no firm shouldn't happen — the seed
    // assigns every user to one and the future invite flow will too.
    throw new Error(
      `User ${userId} has no firm assigned. This is a data integrity issue — re-run the seed or fix the row.`
    );
  }
  return user.firm;
}

/** The firm-level productivity targets. Deliberately NOT part of
 *  `FirmProfile` — the profile shape is mocked across many test
 *  files and most callers (dashboard, /time) only need these two
 *  numbers. Defaults live on the schema (6.0 / 200). */
export type FirmGoals = {
  /** Daily billable-hours target per person — dashboard "Hours
   *  today" KPI + the /time day-view progress bar. */
  dailyHoursGoal: number;
  /** Monthly firm-wide billable-hours target — firm pulse card. */
  monthlyBillableGoal: number;
};

/** The current user's firm goals. Same resolution path (and the
 *  same no-firm integrity error) as `getCurrentFirm()`, but selects
 *  only the two goal columns. */
export async function getFirmGoals(): Promise<FirmGoals> {
  const userId = await getCurrentUserId();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      firm: {
        select: { dailyHoursGoal: true, monthlyBillableGoal: true },
      },
    },
  });
  if (!user?.firm) {
    throw new Error(
      `User ${userId} has no firm assigned. This is a data integrity issue — re-run the seed or fix the row.`
    );
  }
  return user.firm;
}

/** True when the current user holds the firm's "Admin" role and is
 *  active. Cheap — single user-by-id lookup with a count. Use the
 *  throwing variant `requireAdmin()` inside server actions where
 *  the failure mode should be a redirect, not an in-page conditional. */
export async function isCurrentUserAdmin(): Promise<boolean> {
  const userId = await getCurrentUserId();
  const hits = await prisma.user.count({
    where: {
      id: userId,
      isActive: true,
      userRoles: { some: { role: { name: ADMIN_ROLE_NAME } } },
    },
  });
  return hits > 0;
}

/** Server-action guard. Bounces non-admins to the dashboard so
 *  they never see (or trigger) admin-only mutations. The page-level
 *  read view can still render via `isCurrentUserAdmin()` for
 *  non-admins — this is for the WRITE path only. */
export async function requireAdmin(): Promise<string> {
  const userId = await getCurrentUserId();
  const isAdmin = await prisma.user.count({
    where: {
      id: userId,
      isActive: true,
      userRoles: { some: { role: { name: ADMIN_ROLE_NAME } } },
    },
  });
  if (isAdmin === 0) {
    // In Next.js 16's streaming RSC context, redirect() emits a
    // client-side <meta http-equiv="refresh"> rather than a 307 —
    // the page may still render briefly before the browser hops.
    // For pages that absolutely must not flash, gate at the layout
    // level instead of the page.
    redirect("/");
  }
  return userId;
}
