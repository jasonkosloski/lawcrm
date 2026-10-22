/**
 * AssemblyAI completion webhook.
 *
 * The proxy exempts this path (SELF_AUTHENTICATED_PATHS); the per-job
 * secret header set at submit time is the only control. The body is
 * never trusted beyond the job id: the finisher re-fetches the result
 * from the provider. Unknown or stale job ids (a re-run replaced them)
 * answer 200 so the provider doesn't retry.
 */

import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { WEBHOOK_SECRET_HEADER } from "@/lib/transcription/assemblyai";
import { finishTranscriptJob } from "@/lib/transcription/jobs";

function secretMatches(provided: string | null, expected: string): boolean {
  if (provided === null) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<Response> {
  let jobId: unknown;
  try {
    jobId = ((await request.json()) as { transcript_id?: unknown })
      ?.transcript_id;
  } catch {
    return Response.json({ ok: true });
  }
  if (typeof jobId !== "string" || !jobId) return Response.json({ ok: true });

  const t = await prisma.transcript.findUnique({
    where: { providerJobId: jobId },
    select: { id: true, webhookSecret: true },
  });
  if (!t) return Response.json({ ok: true });
  // Already finished (secret cleared): nothing left to do.
  if (!t.webhookSecret) return Response.json({ ok: true });

  if (
    !secretMatches(request.headers.get(WEBHOOK_SECRET_HEADER), t.webhookSecret)
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await finishTranscriptJob(t.id);
  } catch (err) {
    console.error("[assemblyai-webhook] finish failed", err);
    return Response.json({ error: "Failed" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
