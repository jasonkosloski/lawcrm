/**
 * Matter-team access ("ethical walls") — server-only.
 *
 * A user can see a matter, and everything attached to it, when ANY of:
 *   1. they are an ACTIVE member of its team (`MatterTeamMember`,
 *      `removedAt = null`);
 *   2. they hold `matters.view_all` (Admin implicitly);
 *   3. the firm's `matterVisibility` is still `FIRM` (the default —
 *      everyone sees everything, the pre-wall behaviour).
 *
 * Seeing is the precondition for doing: every matter-scoped write
 * asserts the same access on top of its permission key. A hidden
 * matter is indistinguishable from a missing one — denial is
 * `notFound()` (404), never 403 — so its existence doesn't leak.
 *
 * Three shapes, one rule:
 *   - LIST paths spread `matterAccessWhere(userId)` into a Matter
 *     `where` (or `matterRelationAccessWhere` into a child's `where`);
 *   - DETAIL paths / actions call `assertMatterAccess(matterId)`;
 *   - CHILD-id paths call `assertChildMatterAccess(kind, id)`, which
 *     resolves the child's matterId first.
 *
 * Scope resolution is cached per request (React `cache()`), keyed by
 * userId, so a page that asserts several times costs one query.
 * See docs/PERMISSIONS.md "Matter access" and ADR-039.
 */

import { cache } from "react";
import { notFound } from "next/navigation";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { ADMIN_ROLE_NAME } from "@/lib/role-constants";

/** Permission key that lifts the wall for every matter. */
export const MATTERS_VIEW_ALL = "matters.view_all";

export type MatterAccessScope = {
  /** True when the user sees every matter (view-all holder, Admin,
   *  or the firm is in FIRM mode). */
  all: boolean;
  /** False for unknown / inactive users: they see nothing at all. */
  active: boolean;
};

const resolveScope = cache(
  async (userId: string): Promise<MatterAccessScope> => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        isActive: true,
        firm: { select: { matterVisibility: true } },
        userRoles: {
          select: {
            role: {
              select: {
                name: true,
                permissions: {
                  where: { permission: MATTERS_VIEW_ALL },
                  select: { permission: true },
                },
              },
            },
          },
        },
      },
    });
    if (!user || !user.isActive) return { all: false, active: false };
    if (user.firm?.matterVisibility !== "TEAM") {
      return { all: true, active: true };
    }
    const viewAll = user.userRoles.some(
      (ur) => ur.role.name === ADMIN_ROLE_NAME || ur.role.permissions.length > 0
    );
    return { all: viewAll, active: true };
  }
);

export async function getMatterAccessScope(
  userId: string
): Promise<MatterAccessScope> {
  return resolveScope(userId);
}

/** Match-nothing fragment for users who may not see any matter. */
const NO_MATTERS: Prisma.MatterWhereInput = { id: { in: [] } };

/**
 * Prisma `Matter` where-fragment for "matters this user may see".
 * `{}` (no restriction) for view-all holders, Admins and FIRM-mode
 * firms. Spread/AND it into every matter list, count and aggregate.
 */
export async function matterAccessWhere(
  userId: string
): Promise<Prisma.MatterWhereInput> {
  const scope = await resolveScope(userId);
  if (!scope.active) return NO_MATTERS;
  if (scope.all) return {};
  return { teamMembers: { some: { userId, removedAt: null } } };
}

/**
 * The same restriction for a child model that has a REQUIRED `matter`
 * relation (Document, Deadline, Invoice, ...):
 * `prisma.document.findMany({ where: { ...(await childAccess(uid)) } })`.
 * `{}` when unrestricted.
 */
export async function matterRelationAccessWhere(
  userId: string
): Promise<{ matter?: Prisma.MatterWhereInput }> {
  const where = await matterAccessWhere(userId);
  return Object.keys(where).length === 0 ? {} : { matter: where };
}

/**
 * For children whose `matter` relation is OPTIONAL (TimeEntry, Note, Task,
 * CalendarEvent, EmailThread, ActivityLog, Notification): rows with
 * no matter stay visible, matter-linked rows must be accessible.
 * Returns a where-fragment to AND into the child's `where`
 * (`{}` when unrestricted).
 */
export async function optionalMatterAccessWhere(
  userId: string
): Promise<{ OR?: Array<Record<string, unknown>> }> {
  const where = await matterAccessWhere(userId);
  if (Object.keys(where).length === 0) return {};
  return { OR: [{ matterId: null }, { matter: where }] };
}

/** Wrap `optionalMatterAccessWhere` as a standalone clause so it can
 *  be placed in an `AND: [...]` without clobbering an existing `OR`. */
export async function optionalMatterAccessClause(
  userId: string
): Promise<Array<Record<string, unknown>>> {
  const frag = await optionalMatterAccessWhere(userId);
  return Object.keys(frag).length === 0 ? [] : [frag];
}

/** True when `userId` may see `matterId`. Unknown matter → false. */
export async function canAccessMatter(
  userId: string,
  matterId: string
): Promise<boolean> {
  const scope = await resolveScope(userId);
  if (!scope.active) return false;
  if (scope.all) {
    const exists = await prisma.matter.findUnique({
      where: { id: matterId },
      select: { id: true },
    });
    return !!exists;
  }
  const hit = await prisma.matter.findFirst({
    where: {
      id: matterId,
      teamMembers: { some: { userId, removedAt: null } },
    },
    select: { id: true },
  });
  return !!hit;
}

/**
 * Page / action guard for the CURRENT user: 404s when the matter is
 * missing or hidden from them. Never wrap in try/catch (it throws
 * Next's not-found signal). Returns the user id for chaining.
 */
export async function assertMatterAccess(matterId: string): Promise<string> {
  const userId = await getCurrentUserId();
  if (!(await canAccessMatter(userId, matterId))) notFound();
  return userId;
}

/** Same as `assertMatterAccess` but tolerates a null matter id (for
 *  records that may be firm-wide, e.g. tasks or events). */
export async function assertOptionalMatterAccess(
  matterId: string | null | undefined
): Promise<string> {
  if (!matterId) return getCurrentUserId();
  return assertMatterAccess(matterId);
}

// ── Child records reached by their own id ───────────────────────────────

const CHILD_RESOLVERS = {
  note: (id: string) =>
    prisma.note.findUnique({ where: { id }, select: { matterId: true } }),
  document: (id: string) =>
    prisma.document.findUnique({ where: { id }, select: { matterId: true } }),
  documentFolder: (id: string) =>
    prisma.documentFolder.findUnique({
      where: { id },
      select: { matterId: true },
    }),
  evidence: (id: string) =>
    prisma.evidence.findUnique({ where: { id }, select: { matterId: true } }),
  deadline: (id: string) =>
    prisma.deadline.findUnique({ where: { id }, select: { matterId: true } }),
  task: (id: string) =>
    prisma.task.findUnique({ where: { id }, select: { matterId: true } }),
  calendarEvent: (id: string) =>
    prisma.calendarEvent.findUnique({
      where: { id },
      select: { matterId: true },
    }),
  timeEntry: (id: string) =>
    prisma.timeEntry.findUnique({ where: { id }, select: { matterId: true } }),
  expense: (id: string) =>
    prisma.expense.findUnique({ where: { id }, select: { matterId: true } }),
  invoice: (id: string) =>
    prisma.invoice.findUnique({ where: { id }, select: { matterId: true } }),
  invoicePayment: (id: string) =>
    prisma.invoicePayment
      .findUnique({ where: { id }, select: { invoice: { select: { matterId: true } } } })
      .then((r) => (r ? { matterId: r.invoice.matterId } : null)),
  trustTransaction: (id: string) =>
    prisma.trustTransaction.findUnique({
      where: { id },
      select: { matterId: true },
    }),
  settlement: (id: string) =>
    prisma.settlement.findUnique({ where: { id }, select: { matterId: true } }),
  settlementLien: (id: string) =>
    prisma.settlementLien
      .findUnique({
        where: { id },
        select: { settlement: { select: { matterId: true } } },
      })
      .then((r) => (r ? { matterId: r.settlement.matterId } : null)),
  settlementApproval: (id: string) =>
    prisma.settlementApproval
      .findUnique({
        where: { id },
        select: { settlement: { select: { matterId: true } } },
      })
      .then((r) => (r ? { matterId: r.settlement.matterId } : null)),
  /** A MatterContact row (a party on a matter). */
  party: (id: string) =>
    prisma.matterContact.findUnique({
      where: { id },
      select: { matterId: true },
    }),
  emailThread: (id: string) =>
    prisma.emailThread.findUnique({ where: { id }, select: { matterId: true } }),
  flaggedMoment: (id: string) =>
    prisma.flaggedMoment
      .findUnique({
        where: { id },
        select: {
          document: { select: { matterId: true } },
          evidence: { select: { matterId: true } },
        },
      })
      .then((r) =>
        r
          ? { matterId: r.document?.matterId ?? r.evidence?.matterId ?? null }
          : null
      ),
} as const;

export type MatterChildKind = keyof typeof CHILD_RESOLVERS;

/**
 * Resolve the matter a child record belongs to.
 * `undefined` = the record does not exist; `null` = it exists but is
 * not matter-scoped (firm-wide task, personal event, unfiled email).
 */
export async function matterIdOfChild(
  kind: MatterChildKind,
  id: string
): Promise<string | null | undefined> {
  const row = await (CHILD_RESOLVERS[kind] as (
    id: string
  ) => Promise<{ matterId: string | null } | null>)(id);
  if (!row) return undefined;
  return row.matterId;
}

/**
 * Guard for a child record reached by its own id: resolves its matter
 * and 404s when the current user can't see it. A missing record or a
 * record with no matter passes through untouched — the caller's own
 * not-found / permission handling still applies (and a missing id
 * reveals nothing). Returns the resolved matterId (if any).
 */
export async function assertChildMatterAccess(
  kind: MatterChildKind,
  id: string
): Promise<string | null> {
  const matterId = await matterIdOfChild(kind, id);
  if (!matterId) return null;
  await assertMatterAccess(matterId);
  return matterId;
}

/**
 * Filter a list of ids down to the matters the user may see. For
 * callers that already hold ids (e.g. cached result sets).
 */
export async function filterAccessibleMatterIds(
  userId: string,
  matterIds: readonly string[]
): Promise<Set<string>> {
  const unique = [...new Set(matterIds)];
  if (unique.length === 0) return new Set();
  const where = await matterAccessWhere(userId);
  const rows = await prisma.matter.findMany({
    where: { AND: [where, { id: { in: unique } }] },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}
