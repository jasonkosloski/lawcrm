import "server-only";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-log";
import { createNotification } from "@/lib/notifications";
import { scopeBasePath, scopeOf } from "@/lib/record-scope";
import { deleteJob, fetchJob } from "./assemblyai";
import { normalizeAssemblyAI } from "./normalize";

/** A job still unfinished this long after the request is abandoned. */
const JOB_TIMEOUT_MS = 6 * 3600_000;
/** A claimed row with no provider job id this long after the request
 *  never reached the provider (the request died mid-flight). */
export const QUEUED_STALE_MS = 10 * 60_000;
/** Purge rows older than this are given up on. */
const PURGE_GIVE_UP_MS = 7 * 86_400_000;
const PURGE_BATCH = 25;

/** Delete the provider copy; when the provider refuses (it may not delete
 *  a non-terminal job), queue it so the sweep retries. */
async function deleteProviderCopy(jobId: string): Promise<void> {
  if (await deleteJob(jobId)) return;
  await prisma.transcriptPurge.upsert({
    where: { providerJobId: jobId },
    create: { providerJobId: jobId },
    update: {},
  });
}

/** Retry queued provider deletions, oldest first. Bounded per run. */
export async function drainTranscriptPurges(): Promise<{
  deleted: number;
  retried: number;
  gaveUp: number;
}> {
  const out = { deleted: 0, retried: 0, gaveUp: 0 };
  const rows = await prisma.transcriptPurge.findMany({
    orderBy: { createdAt: "asc" },
    take: PURGE_BATCH,
  });
  for (const r of rows) {
    if (await deleteJob(r.providerJobId)) {
      await prisma.transcriptPurge.deleteMany({ where: { id: r.id } });
      out.deleted++;
    } else if (Date.now() - r.createdAt.getTime() > PURGE_GIVE_UP_MS) {
      console.warn(
        `[transcription] giving up deleting provider job ${r.providerJobId}`,
      );
      await prisma.transcriptPurge.deleteMany({ where: { id: r.id } });
      out.gaveUp++;
    } else {
      await prisma.transcriptPurge.update({
        where: { id: r.id },
        data: { attempts: { increment: 1 } },
      });
      out.retried++;
    }
  }
  return out;
}

export type FinishOutcome = "completed" | "failed" | "pending" | "gone";

/**
 * Settle one transcript job: ask the provider, and on a terminal answer
 * write the result. Shared by the webhook and the sweep, so it must be
 * idempotent: every write is guarded on the row still being in flight
 * with the same provider job id, so a duplicate webhook, a sweep racing
 * a webhook, or a re-run that replaced the job writes nothing twice.
 */
export async function finishTranscriptJob(
  transcriptId: string,
): Promise<FinishOutcome> {
  const t = await prisma.transcript.findUnique({
    where: { id: transcriptId },
    include: {
      document: { select: { id: true, name: true, matterId: true, leadId: true } },
    },
  });
  if (!t) return "gone";
  if (t.status === "completed") return "completed";
  if (t.status === "failed") return "failed";

  const inFlight = {
    id: t.id,
    providerJobId: t.providerJobId,
    status: { in: ["queued", "processing"] },
  };
  const scope = scopeOf(t.document);
  const link = `${scopeBasePath(scope)}/documents/${t.document.id}`;
  const base = { matterId: t.document.matterId, leadId: t.document.leadId };

  const refresh = () => {
    try {
      revalidatePath(link);
    } catch {
      // No request context (cron/webhook outside a render): nothing to refresh.
    }
  };

  const fail = async (message: string): Promise<FinishOutcome> => {
    const res = await prisma.transcript.updateMany({
      where: inFlight,
      data: { status: "failed", error: message, webhookSecret: null },
    });
    if (res.count === 0) return "pending";
    if (t.providerJobId) await deleteProviderCopy(t.providerJobId);
    refresh();
    await logActivity({
      ...base,
      userId: t.requestedById,
      type: "document",
      title: "Transcription failed",
      detail: t.document.name,
    });
    await createNotification({
      userId: t.requestedById,
      type: "transcript_failed",
      title: "Transcription failed",
      body: `${t.document.name}: ${message}`,
      link,
      matterId: t.document.matterId,
    });
    return "failed";
  };

  const age = Date.now() - t.requestedAt.getTime();
  const timedOut = age > JOB_TIMEOUT_MS;

  if (!t.providerJobId) {
    if (age > QUEUED_STALE_MS) return fail("Timed out");
    return "pending";
  }

  let job: Awaited<ReturnType<typeof fetchJob>>;
  try {
    job = await fetchJob(t.providerJobId);
  } catch (err) {
    console.warn(
      "[transcription] fetchJob failed",
      err instanceof Error ? err.message : String(err),
    );
    return timedOut ? fail("Timed out") : "pending";
  }

  if (job.status === "error") {
    return fail(job.error ?? "Transcription failed");
  }
  if (job.status !== "completed" || !job.raw) {
    return timedOut ? fail("Timed out") : "pending";
  }

  const result = normalizeAssemblyAI(job.raw);
  const speakers = Object.fromEntries(
    result.speakers.map((label) => [label, `Speaker ${label}`]),
  );

  const won = await prisma.$transaction(async (tx) => {
    const res = await tx.transcript.updateMany({
      where: inFlight,
      data: {
        status: "completed",
        error: null,
        durationSeconds: result.durationSeconds,
        language: result.language,
        speakers,
        completedAt: new Date(),
        webhookSecret: null,
        correctedAt: null,
        correctedById: null,
      },
    });
    if (res.count === 0) return false;
    await tx.transcriptSegment.deleteMany({ where: { transcriptId: t.id } });
    if (result.segments.length > 0) {
      await tx.transcriptSegment.createMany({
        data: result.segments.map((s) => ({
          transcriptId: t.id,
          index: s.index,
          speaker: s.speaker,
          startSeconds: s.startSeconds,
          endSeconds: s.endSeconds,
          text: s.text,
          words: s.words,
        })),
      });
    }
    return true;
  });
  if (!won) return "pending";

  await deleteProviderCopy(t.providerJobId);
  refresh();
  await logActivity({
    ...base,
    userId: t.requestedById,
    type: "document",
    title: "Transcript ready",
    detail: t.document.name,
  });
  await createNotification({
    userId: t.requestedById,
    type: "transcript_ready",
    title: "Transcript ready",
    body: t.document.name,
    link,
    matterId: t.document.matterId,
  });
  return "completed";
}
