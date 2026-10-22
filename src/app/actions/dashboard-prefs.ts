/**
 * Server actions for dashboard preferences.
 *
 * `saveDashboardLayout` persists the whole band + columns layout
 * (`{ v: 3, split, band, columns, hidden }`) wholesale. Auth runs
 * first, non-object input is rejected, and the payload is sanitized
 * server-side via `mergeLayout` (unknown keys dropped, missing cards
 * appended to their default zone) so a stale or malicious client can
 * never persist a broken layout.
 */

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { mergeLayout, type DashboardLayout } from "@/lib/dashboard-prefs";

/**
 * Persist the full v3 layout for the current user. Returns the
 * sanitized layout so the caller can reconcile.
 */
export async function saveDashboardLayout(layout: unknown): Promise<DashboardLayout> {
  // Authenticate first so an anonymous caller gets an auth error.
  const userId = await getCurrentUserId();
  if (typeof layout !== "object" || layout === null || Array.isArray(layout)) {
    throw new Error("layout must be an object");
  }
  const next = mergeLayout({ ...(layout as Record<string, unknown>), v: 3 });

  await prisma.user.update({
    where: { id: userId },
    data: { dashboardPrefs: next },
  });

  revalidatePath("/");
  return next;
}
