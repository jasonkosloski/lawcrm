/**
 * Matter-draft sweep — SYSTEM endpoint.
 *
 * Sanctioned API-route exception to "mutations are server actions": a
 * platform-scheduler cron, not a user mutation (same as
 * /api/notification-sweep). Authorized by the CRON_SECRET bearer
 * (fail closed); the proxy exempts the path in SELF_AUTHENTICATED_PATHS.
 *
 * Deletes drafts untouched for MATTER_DRAFT_RETENTION_DAYS, in batches.
 * MatterDraftFile cascades with the draft, so each batch's file keys are
 * loaded first, the rows deleted, and only then the stored bytes removed
 * (best effort: a storage failure is logged and skipped, never aborts).
 */

import { prisma } from "@/lib/prisma";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { deleteFile } from "@/lib/file-storage";
import { MATTER_DRAFT_RETENTION_DAYS } from "@/lib/draft-access";

export const maxDuration = 60;

const BATCH_SIZE = 100;
const DAY_MS = 86_400_000;

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCron(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - MATTER_DRAFT_RETENTION_DAYS * DAY_MS);
  let deleted = 0;

  try {
    for (;;) {
      const batch = await prisma.matterDraft.findMany({
        where: { updatedAt: { lt: cutoff } },
        select: { id: true, files: { select: { fileUrl: true } } },
        orderBy: { updatedAt: "asc" },
        take: BATCH_SIZE,
      });
      if (batch.length === 0) break;

      // Re-check staleness per draft: one saved since the read above
      // survives, and only deleted drafts lose their stored bytes.
      const keys: string[] = [];
      let count = 0;
      for (const d of batch) {
        const res = await prisma.matterDraft.deleteMany({
          where: { id: d.id, updatedAt: { lt: cutoff } },
        });
        if (res.count > 0) {
          count += res.count;
          keys.push(...d.files.map((f) => f.fileUrl));
        }
      }
      deleted += count;

      for (const key of keys) {
        try {
          await deleteFile(key);
        } catch (err) {
          console.error("[matter-draft-sweep] storage cleanup failed", {
            key,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // A batch that deleted nothing (rows vanished) must not spin.
      if (count === 0) break;
    }
  } catch (err) {
    console.error("[matter-draft-sweep] sweep failed", err);
    return Response.json({ error: "Sweep failed" }, { status: 500 });
  }

  console.info(`[matter-draft-sweep] deleted ${deleted} stale draft(s)`);
  return Response.json({ deleted });
}
