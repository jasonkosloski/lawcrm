import "server-only";

import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-log";
import { createNotification } from "@/lib/notifications";
import { scopeBasePath, scopeOf } from "@/lib/record-scope";
import { deleteJob, fetchJob } from "./assemblyai";
import { normalizeAssemblyAI } from "./normalize";

/** A job still unfinished this long after the request is abandoned. */
const JOB_TIMEOUT_MS = 6 * 3600_000;

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

  const fail = async (message: string): Promise<FinishOutcome> => {
    const res = await prisma.transcript.updateMany({
      where: inFlight,
      data: { status: "failed", error: message, webhookSecret: null },
    });
    if (res.count === 0) return "pending";
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

  const timedOut = Date.now() - t.requestedAt.getTime() > JOB_TIMEOUT_MS;

  if (!t.providerJobId) {
    return timedOut ? fail("Timed out") : "pending";
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

  await deleteJob(t.providerJobId);
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
