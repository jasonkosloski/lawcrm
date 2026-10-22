/**
 * Transcription sweep — SYSTEM endpoint (platform cron, every 10 min).
 *
 * Sanctioned API-route exception to "mutations are server actions".
 * Finishes jobs whose webhook never arrived (local storage, no
 * AUTH_URL, or a lost delivery), times out abandoned ones, and retries
 * queued provider-copy deletions (transcript_purges), draining those
 * first and stopping new jobs after ~40 s.
 * Authorized by the CRON_SECRET bearer; exempt in SELF_AUTHENTICATED_PATHS.
 */

import { prisma } from "@/lib/prisma";
import { isAuthorizedCron } from "@/lib/cron-auth";
import {
  QUEUED_STALE_MS,
  drainTranscriptPurges,
  finishTranscriptJob,
} from "@/lib/transcription/jobs";

export const maxDuration = 60;

const BATCH = 25;
const MIN_AGE_MS = 2 * 60_000;
/** Stop starting new jobs after this long (maxDuration is 60 s). */
const TIME_BUDGET_MS = 40_000;

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCron(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  // Purges first: they are cheap and bounded, and must not starve behind a
  // long run of slow provider calls.
  let purges = { deleted: 0, retried: 0, gaveUp: 0 };
  try {
    purges = await drainTranscriptPurges();
  } catch (err) {
    console.error("[transcription-sweep] purge drain failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }
  const rows = await prisma.transcript.findMany({
    where: {
      OR: [
        {
          status: "processing",
          requestedAt: { lt: new Date(Date.now() - MIN_AGE_MS) },
        },
        // Claimed but never submitted: the finisher fails these.
        {
          status: "queued",
          requestedAt: { lt: new Date(Date.now() - QUEUED_STALE_MS) },
        },
      ],
    },
    select: { id: true },
    orderBy: { requestedAt: "asc" },
    take: BATCH,
  });
  const counts = { completed: 0, failed: 0, pending: 0, gone: 0, errors: 0 };
  let skipped = 0;
  for (const r of rows) {
    // maxDuration is 60 s: stop starting new jobs well before it. The rest
    // are picked up (oldest first) by the next run.
    if (Date.now() - started >= TIME_BUDGET_MS) {
      skipped++;
      continue;
    }
    try {
      counts[await finishTranscriptJob(r.id)]++;
    } catch (err) {
      counts.errors++;
      console.error("[transcription-sweep] finish failed", {
        id: r.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return Response.json({ checked: rows.length, skipped, ...counts, purges });
}
