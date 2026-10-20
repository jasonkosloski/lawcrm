/**
 * Matter-draft access — server-only.
 *
 * A draft (pre-conflict-check intake) is visible to its creator, the
 * lead attorney and team seats named on it, and Admin. Being named on
 * a draft never grants intake rights by itself: everyone but Admin
 * must also hold `matters.create`. Hidden is indistinguishable from
 * missing (`notFound()`).
 */

import { notFound } from "next/navigation";
import type { MatterDraft, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { userHasPermission } from "@/lib/permission-check";
import { ADMIN_ROLE_NAME } from "@/lib/role-constants";

/** Drafts untouched this long are swept by the cleanup cron. */
export const MATTER_DRAFT_RETENTION_DAYS = 90;

export const DRAFT_PERMISSION = "matters.create";

/** List filter: Admin sees every draft, everyone else only their own
 *  (created, led, or seated). Callers still gate on `matters.create`. */
export function draftAccessWhere(
  userId: string,
  isAdmin: boolean
): Prisma.MatterDraftWhereInput {
  if (isAdmin) return {};
  return {
    OR: [
      { createdById: userId },
      { leadUserId: userId },
      { teamUserIds: { has: userId } },
    ],
  };
}

async function isAdminUser(userId: string): Promise<boolean> {
  const hits = await prisma.user.count({
    where: {
      id: userId,
      isActive: true,
      userRoles: { some: { role: { name: ADMIN_ROLE_NAME } } },
    },
  });
  return hits > 0;
}

async function loadAccessible(
  userId: string,
  draftId: string
): Promise<MatterDraft | null> {
  const isAdmin = await isAdminUser(userId);
  if (!isAdmin && !(await userHasPermission(userId, DRAFT_PERMISSION))) {
    return null;
  }
  return prisma.matterDraft.findFirst({
    where: { id: draftId, ...draftAccessWhere(userId, isAdmin) },
  });
}

/** Boolean twin for route handlers that hold a verified user id. */
export async function canAccessDraft(
  userId: string,
  draftId: string
): Promise<boolean> {
  return (await loadAccessible(userId, draftId)) !== null;
}

/** Page / action guard: the draft, or `notFound()`. */
export async function assertDraftAccess(draftId: string): Promise<MatterDraft> {
  const userId = await getCurrentUserId();
  const draft = await loadAccessible(userId, draftId);
  if (!draft) notFound();
  return draft;
}
