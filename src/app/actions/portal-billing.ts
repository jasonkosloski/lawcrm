/**
 * Staff action for the client portal billing switch.
 *
 * Gates on `portal.share_billing` and `billing.view` (ADR-038), then
 * asserts matter access (ADR-039) outside any try/catch so a walled user
 * gets Next's not-found.
 */

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { assertMatterAccess } from "@/lib/matter-access";
import {
  PERMISSION_DENIED_MESSAGE,
  currentUserHasPermission,
  requirePermissionResult,
} from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";

type Result = { ok: true } | { ok: false; error: string };

export async function setPortalBilling(matterId: string, enabled: boolean): Promise<Result> {
  const gate = await requirePermissionResult("portal.share_billing");
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!(await currentUserHasPermission("billing.view"))) {
    return { ok: false, error: PERMISSION_DENIED_MESSAGE };
  }
  await assertMatterAccess(matterId);

  // Conditional write: only the call that actually flips the column logs.
  const res = await prisma.matter.updateMany({
    where: { id: matterId, portalBillingEnabled: !enabled },
    data: { portalBillingEnabled: enabled },
  });
  if (res.count > 0) {
    await logActivity({
      matterId,
      userId: gate.userId,
      type: "note",
      title: enabled ? "Showed billing in the client portal" : "Hid billing from the client portal",
    });
  }
  revalidatePath(`/matters/${matterId}`);
  return { ok: true };
}
