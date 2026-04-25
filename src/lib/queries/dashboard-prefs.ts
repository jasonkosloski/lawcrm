/**
 * Dashboard Preferences — server-side loader
 *
 * Server-only access to `User.dashboardPrefs`. Kept separate from the
 * pure types/constants in `src/lib/dashboard-prefs.ts` so the latter
 * stays Prisma-free and importable from client components.
 */

import { prisma } from "@/lib/prisma";
import {
  mergeVisibility,
  type DashboardVisibility,
} from "@/lib/dashboard-prefs";

/**
 * Load the current user's visibility prefs, merged with defaults so any
 * card not explicitly set is visible.
 */
export async function getDashboardVisibility(
  userId: string
): Promise<DashboardVisibility> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { dashboardPrefs: true },
  });
  return mergeVisibility(user?.dashboardPrefs);
}
