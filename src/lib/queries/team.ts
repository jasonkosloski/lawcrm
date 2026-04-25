/**
 * Team / firm-roster queries.
 *
 * Server-only access for the /settings/team roster + edit row, plus
 * the role management pages. Scoped by the current user's firm so
 * everything works as-is when we go multi-tenant.
 */

import { prisma } from "@/lib/prisma";
import { ADMIN_ROLE_NAME, getCurrentFirm } from "@/lib/firm";

/** Compact role view used wherever we render role chips. */
export type RoleChip = {
  id: string;
  name: string;
  isSystem: boolean;
};

export type FirmUserRow = {
  id: string;
  name: string;
  email: string;
  initials: string;
  jobTitle: string;
  phone: string | null;
  barNumber: string | null;
  isActive: boolean;
  /** Roles this user holds, ordered system-first then alpha. The
   *  Admin chip always renders first when present. */
  roles: RoleChip[];
  /** Convenience flag — true when the user holds the Admin role.
   *  Derived from `roles` so the row UI doesn't have to scan. */
  isAdmin: boolean;
  /** True when this row IS the user viewing the page — drives the
   *  "you" badge and disables self-destructive actions. */
  isSelf: boolean;
  createdAt: Date;
};

const ROLE_INCLUDE = {
  userRoles: {
    include: {
      role: { select: { id: true, name: true, isSystem: true } },
    },
  },
} as const;

function shapeRow(
  r: {
    id: string;
    name: string;
    email: string;
    initials: string;
    jobTitle: string;
    phone: string | null;
    barNumber: string | null;
    isActive: boolean;
    createdAt: Date;
    userRoles: Array<{
      role: { id: string; name: string; isSystem: boolean };
    }>;
  },
  currentUserId: string
): FirmUserRow {
  // Sort: Admin first, then other system roles, then custom alpha.
  const roles = r.userRoles
    .map((ur) => ur.role)
    .sort((a, b) => {
      if (a.name === ADMIN_ROLE_NAME) return -1;
      if (b.name === ADMIN_ROLE_NAME) return 1;
      if (a.isSystem !== b.isSystem) return a.isSystem ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    initials: r.initials,
    jobTitle: r.jobTitle,
    phone: r.phone,
    barNumber: r.barNumber,
    isActive: r.isActive,
    roles,
    isAdmin: roles.some((rr) => rr.name === ADMIN_ROLE_NAME),
    isSelf: r.id === currentUserId,
    createdAt: r.createdAt,
  };
}

/**
 * Roster for the firm — admins first, then by name. Includes
 * inactive users so admins can reactivate them; the page filters
 * if it wants to (today it just renders both with a chip).
 */
export async function listFirmUsers(
  currentUserId: string
): Promise<FirmUserRow[]> {
  const firm = await getCurrentFirm();
  const rows = await prisma.user.findMany({
    where: { firmId: firm.id },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      initials: true,
      jobTitle: true,
      phone: true,
      barNumber: true,
      isActive: true,
      createdAt: true,
      ...ROLE_INCLUDE,
    },
  });
  // Re-sort with admins first — Prisma can't sort by a relation
  // count + name in a single query cleanly, so we do it after the
  // role data lands.
  const shaped = rows.map((r) => shapeRow(r, currentUserId));
  shaped.sort((a, b) => {
    if (a.isAdmin !== b.isAdmin) return a.isAdmin ? -1 : 1;
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return shaped;
}

/** Single-user fetch for the edit row. Returns null when not found
 *  (or out-of-firm — defense against URL-tampering once we go
 *  multi-tenant). */
export async function getFirmUserById(
  userId: string,
  currentUserId: string
): Promise<FirmUserRow | null> {
  const firm = await getCurrentFirm();
  const r = await prisma.user.findFirst({
    where: { id: userId, firmId: firm.id },
    select: {
      id: true,
      name: true,
      email: true,
      initials: true,
      jobTitle: true,
      phone: true,
      barNumber: true,
      isActive: true,
      createdAt: true,
      ...ROLE_INCLUDE,
    },
  });
  if (!r) return null;
  return shapeRow(r, currentUserId);
}

/** Count of active users with the Admin role — drives the
 *  "can't demote the last admin" invariant. Cheap; called from
 *  every mutating action that might leave the firm without an
 *  admin. */
export async function countActiveAdmins(): Promise<number> {
  const firm = await getCurrentFirm();
  return prisma.user.count({
    where: {
      firmId: firm.id,
      isActive: true,
      userRoles: { some: { role: { name: ADMIN_ROLE_NAME } } },
    },
  });
}

// ── Role management ───────────────────────────────────────────────────────

export type FirmRoleRow = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  memberCount: number;
  createdAt: Date;
};

/** All roles defined for the firm, ordered system-first then alpha
 *  (with "Admin" pinned to the very top because it's the most-used). */
export async function listFirmRoles(): Promise<FirmRoleRow[]> {
  const firm = await getCurrentFirm();
  const rows = await prisma.role.findMany({
    where: { firmId: firm.id },
    select: {
      id: true,
      name: true,
      description: true,
      isSystem: true,
      createdAt: true,
      _count: { select: { userRoles: true } },
    },
  });
  const shaped: FirmRoleRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    memberCount: r._count.userRoles,
    createdAt: r.createdAt,
  }));
  shaped.sort((a, b) => {
    if (a.name === ADMIN_ROLE_NAME) return -1;
    if (b.name === ADMIN_ROLE_NAME) return 1;
    if (a.isSystem !== b.isSystem) return a.isSystem ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return shaped;
}

/** Compact list for role-picker UIs — same firm scope, admins-first
 *  ordering, member count omitted. */
export async function listRolePickerOptions(): Promise<RoleChip[]> {
  const firm = await getCurrentFirm();
  const rows = await prisma.role.findMany({
    where: { firmId: firm.id },
    select: { id: true, name: true, isSystem: true },
  });
  return rows.sort((a, b) => {
    if (a.name === ADMIN_ROLE_NAME) return -1;
    if (b.name === ADMIN_ROLE_NAME) return 1;
    if (a.isSystem !== b.isSystem) return a.isSystem ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
