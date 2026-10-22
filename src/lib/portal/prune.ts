import "server-only";

import { prisma } from "@/lib/prisma";
import { DAY_MS } from "@/lib/format-date";

/**
 * Delete portal records that can no longer do anything. Run hourly from the
 * notification-sweep cron.
 *   - sessions past expiresAt;
 *   - tokens used or expired more than a day ago (kept a day so a late
 *     click on a spent link is still logged as "Portal link rejected");
 *   - link-request throttle rows older than a day (the window is 15 min).
 */
export async function prunePortalRecords(
  now: Date,
): Promise<{ sessions: number; tokens: number; linkRequests: number }> {
  const cutoff = new Date(now.getTime() - DAY_MS);
  const [sessions, tokens, linkRequests] = await prisma.$transaction([
    prisma.portalSession.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.portalLoginToken.deleteMany({
      where: {
        OR: [{ usedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }],
      },
    }),
    prisma.portalLinkRequest.deleteMany({
      where: { createdAt: { lt: cutoff } },
    }),
  ]);
  return {
    sessions: sessions.count,
    tokens: tokens.count,
    linkRequests: linkRequests.count,
  };
}
