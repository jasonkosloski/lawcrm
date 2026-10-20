"use server";

/**
 * Settings -> Security: revoke one of the signed-in user's other
 * devices. Identity-scoped (no permission key, like the page). The
 * Clerk user id comes ONLY from `getStaffAuth()` on the server; the
 * client sends just a session id, and `revokeStaffSession` refuses a
 * session that belongs to anyone else.
 */

import { revalidatePath } from "next/cache";
import { logAuthEvent } from "@/lib/auth-events";
import { revokeStaffSession } from "@/lib/clerk-admin";
import { getStaffAuth } from "@/lib/staff-auth";

export async function revokeMySession(
  sessionId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await getStaffAuth();
  if (auth.status !== "ok") return { ok: false, error: "Sign in again." };
  if (typeof sessionId !== "string" || !sessionId) {
    return { ok: false, error: "Unknown session." };
  }
  if (sessionId === auth.sessionId) {
    return { ok: false, error: "Use Sign out for this device." };
  }

  const result = await revokeStaffSession(auth.clerkUserId, sessionId);
  if (!result.ok) return result;

  await logAuthEvent({ userId: auth.userId, kind: "session_revoked" });
  revalidatePath("/settings/security");
  return { ok: true };
}
