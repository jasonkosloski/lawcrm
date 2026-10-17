/**
 * Matter-visibility switch (Settings -> Firm). Admin only: flipping
 * to "Team only" hides every matter from people who are not on its
 * team and do not hold `matters.view_all`, so it is deliberately not
 * delegable through a permission key. Every change is logged.
 */

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { loadCurrentFirm, requireAdmin } from "@/lib/firm";
import { logAuditEntry } from "@/lib/audit-entry";

export type MatterVisibilityState = {
  status: "idle" | "ok" | "error";
  error?: string;
};

const LABEL = { FIRM: "Everyone", TEAM: "Team only" } as const;

export async function updateMatterVisibilityAction(
  _prev: MatterVisibilityState,
  formData: FormData
): Promise<MatterVisibilityState> {
  const userId = await requireAdmin();
  const value = formData.get("matterVisibility");
  if (value !== "FIRM" && value !== "TEAM") {
    return { status: "error", error: "Choose Everyone or Team only." };
  }
  const firm = await loadCurrentFirm();
  const before = await prisma.firm.findUniqueOrThrow({
    where: { id: firm.id },
    select: { matterVisibility: true },
  });
  if (before.matterVisibility === value) return { status: "ok" };

  await prisma.firm.update({
    where: { id: firm.id },
    data: { matterVisibility: value },
  });
  await logAuditEntry({
    matterId: null,
    userId,
    type: "settings",
    source: "Settings",
    title: `Matter visibility set to ${LABEL[value]}`,
    detail: `Changed from ${LABEL[before.matterVisibility]} to ${LABEL[value]}`,
  });
  // Visibility changes every matter-scoped surface.
  revalidatePath("/", "layout");
  return { status: "ok" };
}
