/**
 * Dashboard Preferences — server-side loader
 *
 * Server-only access to `User.dashboardPrefs`. Kept separate from the
 * pure types/constants in `src/lib/dashboard-prefs.ts` so the latter
 * stays Prisma-free and importable from client components.
 */

import { prisma } from "@/lib/prisma";
import { mergeLayout, type DashboardLayout } from "@/lib/dashboard-prefs";

/**
 * Load the current user's v3 dashboard layout. Decodes v3 blobs as-is
 * and migrates v1/v2 blobs (`{ visible, order }`) via `mergeLayout`.
 */
export async function getDashboardLayout(userId: string): Promise<DashboardLayout> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { dashboardPrefs: true },
  });
  return mergeLayout(user?.dashboardPrefs);
}
