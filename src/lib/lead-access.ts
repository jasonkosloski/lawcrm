/**
 * Restricted-intake access (lead ethical walls) — server-only.
 *
 * A lead is open to every active user unless `Lead.restricted` is set.
 * A restricted lead, and everything on it, is visible only to:
 *   1. its team (`LeadTeamMember`);
 *   2. holders of `intake.view_restricted` (Admin implicitly).
 * Inactive users see no lead at all.
 *
 * Same shapes as `matter-access.ts`: LIST paths spread
 * `leadAccessWhere(userId)` (or `leadRelationAccessWhere` on a child),
 * DETAIL paths / actions call `assertLeadAccess(leadId)`. Hidden is
 * indistinguishable from missing: `notFound()`, never 403. Scope is
 * cached per request. See ADR-049.
 */

import { cache } from "react";
import { notFound } from "next/navigation";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { ADMIN_ROLE_NAME } from "@/lib/role-constants";

/** Permission key that lifts the wall on every restricted lead. */
export const INTAKE_VIEW_RESTRICTED = "intake.view_restricted";

export type LeadAccessScope = {
  /** True when the user sees every lead (view_restricted / Admin). */
  all: boolean;
  /** False for unknown / inactive users: they see nothing at all. */
  active: boolean;
};

const resolveLeadScope = cache(
  async (userId: string): Promise<LeadAccessScope> => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        isActive: true,
        userRoles: {
          select: {
            role: {
              select: {
                name: true,
                permissions: {
                  where: { permission: INTAKE_VIEW_RESTRICTED },
                  select: { permission: true },
                },
              },
            },
          },
        },
      },
    });
    if (!user || !user.isActive) return { all: false, active: false };
    const all = user.userRoles.some(
      (ur) => ur.role.name === ADMIN_ROLE_NAME || ur.role.permissions.length > 0
    );
    return { all, active: true };
  }
);

export async function getLeadAccessScope(
  userId: string
): Promise<LeadAccessScope> {
  return resolveLeadScope(userId);
}

const NO_LEADS: Prisma.LeadWhereInput = { id: { in: [] } };

/**
 * Prisma `Lead` where-fragment for "leads this user may see". `{}`
 * for view_restricted holders and Admins. AND it into every lead
 * list, count and search.
 */
export async function leadAccessWhere(
  userId: string
): Promise<Prisma.LeadWhereInput> {
  const scope = await resolveLeadScope(userId);
  if (!scope.active) return NO_LEADS;
  if (scope.all) return {};
  return {
    OR: [{ restricted: false }, { teamMembers: { some: { userId } } }],
  };
}

/** The same restriction for a child with a `lead` relation:
 *  `{ lead: … }`, or `{}` when unrestricted. */
export async function leadRelationAccessWhere(
  userId: string
): Promise<{ lead?: Prisma.LeadWhereInput }> {
  const where = await leadAccessWhere(userId);
  return Object.keys(where).length === 0 ? {} : { lead: where };
}

/** True when `userId` may see `leadId`. Unknown lead → false. */
export async function canAccessLead(
  userId: string,
  leadId: string
): Promise<boolean> {
  const where = await leadAccessWhere(userId);
  const hit = await prisma.lead.findFirst({
    where: { AND: [{ id: leadId }, where] },
    select: { id: true },
  });
  return !!hit;
}

/**
 * Page / action guard for the CURRENT user: 404s when the lead is
 * missing or hidden. Never wrap in try/catch. Returns the user id.
 */
export async function assertLeadAccess(leadId: string): Promise<string> {
  const userId = await getCurrentUserId();
  if (!(await canAccessLead(userId, leadId))) notFound();
  return userId;
}

/** Filter lead ids down to the ones the user may see. */
export async function filterAccessibleLeadIds(
  userId: string,
  leadIds: readonly string[]
): Promise<Set<string>> {
  const unique = [...new Set(leadIds)];
  if (unique.length === 0) return new Set();
  const where = await leadAccessWhere(userId);
  const rows = await prisma.lead.findMany({
    where: { AND: [where, { id: { in: unique } }] },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}
