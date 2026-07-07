/**
 * Dashboard Preferences — server-side loader
 *
 * Server-only access to `User.dashboardPrefs`. Kept separate from the
 * pure types/constants in `src/lib/dashboard-prefs.ts` so the latter
 * stays Prisma-free and importable from client components.
 */

import { prisma } from "@/lib/prisma";
import { mergePrefs, type DashboardPrefs } from "@/lib/dashboard-prefs";

/**
 * Load the current user's dashboard prefs (visibility + card order),
 * merged with defaults so any card not explicitly set is visible and
 * any card missing from the stored order is appended in default order.
 */
export async function getDashboardPrefs(
  userId: string
): Promise<DashboardPrefs> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { dashboardPrefs: true },
  });
  return mergePrefs(user?.dashboardPrefs);
}
