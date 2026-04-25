/**
 * Team / firm-roster queries.
 *
 * Server-only access for the /settings/team roster + edit row.
 * Scoped by the current user's firm so it works as-is when we go
 * multi-tenant.
 */

import { prisma } from "@/lib/prisma";
import { getCurrentFirm } from "@/lib/firm";

export type FirmUserRow = {
  id: string;
  name: string;
  email: string;
  initials: string;
  role: string;
  phone: string | null;
  barNumber: string | null;
  isAdmin: boolean;
  isActive: boolean;
  /** True when this row IS the user viewing the page — drives the
   *  "you" badge and disables self-destructive actions. */
  isSelf: boolean;
  createdAt: Date;
};

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
    orderBy: [
      // Admins float to the top so the "who can change firm
      // settings" answer is one glance.
      { isAdmin: "desc" },
      // Active before deactivated within each admin bucket.
      { isActive: "desc" },
      { name: "asc" },
    ],
    select: {
      id: true,
      name: true,
      email: true,
      initials: true,
      role: true,
      phone: true,
      barNumber: true,
      isAdmin: true,
      isActive: true,
      createdAt: true,
    },
  });
  return rows.map((r) => ({ ...r, isSelf: r.id === currentUserId }));
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
      role: true,
      phone: true,
      barNumber: true,
      isAdmin: true,
      isActive: true,
      createdAt: true,
    },
  });
  if (!r) return null;
  return { ...r, isSelf: r.id === currentUserId };
}

/** Count of active admins in the firm — drives the "can't demote
 *  the last admin" invariant. Cheap; called from every mutating
 *  action that might leave the firm without an admin. */
export async function countActiveAdmins(): Promise<number> {
  const firm = await getCurrentFirm();
  return prisma.user.count({
    where: { firmId: firm.id, isAdmin: true, isActive: true },
  });
}
