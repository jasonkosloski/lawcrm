/**
 * Batched "who holds this permission" lookup — server-only.
 *
 * `currentUserHasPermission` answers for the signed-in user; this
 * answers for a set of OTHER users in one query (notification
 * fan-out, where a per-user resolve would be N round-trips). Same
 * resolution rules as src/lib/permission-check.ts: active users
 * only, the Admin role is a wildcard, otherwise any held role with a
 * RolePermission row for the key grants it.
 */

import { prisma } from "@/lib/prisma";
import { ADMIN_ROLE_NAME } from "@/lib/role-constants";

/** The subset of `userIds` that currently hold `permission`. */
export async function filterUsersWithPermission(
  userIds: readonly string[],
  permission: string
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await prisma.user.findMany({
    where: {
      id: { in: [...userIds] },
      isActive: true,
      userRoles: {
        some: {
          role: {
            OR: [
              { name: ADMIN_ROLE_NAME },
              { permissions: { some: { permission } } },
            ],
          },
        },
      },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
