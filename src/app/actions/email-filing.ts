/**
 * File-to-matter actions for email threads.
 *
 * Today's surface: a single "set the matter for this thread"
 * action. The thread-reader header uses a picker that calls this
 * with either a matter id (file) or null (unfile back to the inbox).
 *
 * When auto-filing rules land (subject keywords / sender ↔ matter
 * party / etc.) they'll write to the same FK; this action becomes
 * the "manual override" path.
 */

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-log";
import { getCurrentUserId } from "@/lib/current-user";

export async function setEmailThreadMatter(
  threadId: string,
  /** Matter to assign — pass null to unfile. */
  matterId: string | null
): Promise<{ ok: boolean; error?: string }> {
  const thread = await prisma.emailThread.findUnique({
    where: { id: threadId },
    select: { id: true, subject: true, matterId: true },
  });
  if (!thread) return { ok: false, error: "Thread not found" };

  // Verify the target matter exists when filing — defends against
  // stale picker values + makes the activity log honest.
  if (matterId) {
    const matter = await prisma.matter.findUnique({
      where: { id: matterId },
      select: { id: true, name: true },
    });
    if (!matter) return { ok: false, error: "Matter not found" };

    await prisma.emailThread.update({
      where: { id: threadId },
      data: { matterId },
    });

    const userId = await getCurrentUserId();
    await logActivity({
      matterId,
      userId,
      type: "email",
      title: "Email filed to matter",
      detail: thread.subject,
    });
  } else {
    // Unfile — leave the previous matter's revalidation paths in
    // place so the moved-out side updates too.
    await prisma.emailThread.update({
      where: { id: threadId },
      data: { matterId: null },
    });
  }

  revalidatePath("/communication");
  if (matterId) revalidatePath(`/matters/${matterId}/communication`);
  if (thread.matterId && thread.matterId !== matterId) {
    revalidatePath(`/matters/${thread.matterId}/communication`);
  }
  return { ok: true };
}
