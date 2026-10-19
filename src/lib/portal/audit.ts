import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Portal audit row. Fire-and-forget like `logActivity`: a failed write is
 * logged and never thrown. Only call for real identities, and never put a
 * token in `title` or `detail`.
 */
export async function logPortalEvent(input: {
  identityId: string;
  matterId?: string | null;
  title: string;
  detail?: string;
}): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        matterId: input.matterId ?? null,
        userId: null,
        type: "auth",
        icon: "shield",
        source: "Security",
        title: input.title,
        detail:
          `portal identity ${input.identityId}` +
          (input.detail ? ` ${input.detail}` : ""),
      },
    });
  } catch (err) {
    console.error("[portal-audit] failed to write entry", err);
  }
}
