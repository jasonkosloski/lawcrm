/**
 * Server actions for dashboard preferences.
 *
 * v1: show/hide toggles per card. The whole visibility map is rewritten
 * on every change — small object, no need for partial updates.
 */

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import {
  DASHBOARD_CARD_KEYS,
  type DashboardCardKey,
  type DashboardVisibility,
} from "@/lib/dashboard-prefs";
import { getDashboardVisibility } from "@/lib/queries/dashboard-prefs";

/** Toggle one card's visibility for the current user. */
export async function setDashboardCardVisible(
  cardKey: DashboardCardKey,
  visible: boolean
): Promise<DashboardVisibility> {
  if (!DASHBOARD_CARD_KEYS.includes(cardKey)) {
    throw new Error(`Unknown dashboard card key: ${cardKey}`);
  }

  const userId = await getCurrentUserId();
  const current = await getDashboardVisibility(userId);
  const next: DashboardVisibility = { ...current, [cardKey]: visible };

  await prisma.user.update({
    where: { id: userId },
    data: { dashboardPrefs: { visible: next } },
  });

  revalidatePath("/");
  return next;
}
