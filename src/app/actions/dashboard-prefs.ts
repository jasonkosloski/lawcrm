/**
 * Server actions for dashboard preferences.
 *
 * v2: show/hide toggles per card + per-column card ordering. The whole
 * prefs blob (`{ visible, order }`) is rewritten on every change —
 * small object, no need for partial updates — so BOTH halves must
 * always be written together or one would clobber the other.
 *
 * Payloads are additive over v1: `setDashboardCardVisible` keeps its
 * v1 signature (old clients keep working); ordering is a separate
 * action that takes the full desired order and sanitizes it
 * server-side via `mergeOrder` (unknown keys dropped, missing keys
 * appended), so a stale or malicious client can never persist a
 * broken order.
 */

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import {
  DASHBOARD_CARD_KEYS,
  mergeOrder,
  type DashboardCardKey,
  type DashboardVisibility,
} from "@/lib/dashboard-prefs";
import { getDashboardPrefs } from "@/lib/queries/dashboard-prefs";

/** Toggle one card's visibility for the current user. */
export async function setDashboardCardVisible(
  cardKey: DashboardCardKey,
  visible: boolean
): Promise<DashboardVisibility> {
  if (!DASHBOARD_CARD_KEYS.includes(cardKey)) {
    throw new Error(`Unknown dashboard card key: ${cardKey}`);
  }

  const userId = await getCurrentUserId();
  const current = await getDashboardPrefs(userId);
  const next: DashboardVisibility = { ...current.visible, [cardKey]: visible };

  await prisma.user.update({
    where: { id: userId },
    // Write order back too — the blob is replaced wholesale.
    data: { dashboardPrefs: { visible: next, order: current.order } },
  });

  revalidatePath("/");
  return next;
}

/**
 * Persist the full card order for the current user. The client sends
 * its desired order (usually one up/down swap away from the current
 * one); the server sanitizes it through `mergeOrder` and returns the
 * canonical result so the caller can reconcile.
 */
export async function setDashboardCardOrder(
  order: string[]
): Promise<DashboardCardKey[]> {
  const userId = await getCurrentUserId();
  const current = await getDashboardPrefs(userId);
  const next = mergeOrder({ order });

  await prisma.user.update({
    where: { id: userId },
    // Write visibility back too — the blob is replaced wholesale.
    data: { dashboardPrefs: { visible: current.visible, order: next } },
  });

  revalidatePath("/");
  return next;
}
