"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permission-check";
import { assertChildMatterAccess } from "@/lib/matter-access";
import { logActivity } from "@/lib/activity-log";
import {
  activeStorageDriver,
  readStoredFile,
  signedBlobUrl,
} from "@/lib/file-storage";
import { scopeBasePath, scopeOf, scopeWhere } from "@/lib/record-scope";
import { DEFAULT_TIME_ZONE } from "@/lib/current-user-tz";
import { resolveDocumentRenderer } from "@/components/documents-viewer/resolve-renderer";
import {
  deleteJob,
  submitJob,
  transcriptionConfigured,
  uploadBytes,
} from "@/lib/transcription/assemblyai";
import { capExceeded, monthStart } from "@/lib/transcription/cap";
import { alignWords } from "@/lib/transcription/align";
import { wordsToText } from "@/lib/transcription/normalize";
import type { Word } from "@/lib/transcription/types";

export type RequestTranscriptResult =
  | { ok: true; status: "processing" | "completed" }
  | { ok: false; error: string; needsConfirm?: "replace_corrections" };

const IN_FLIGHT = ["queued", "processing"];
const ALREADY = "Already transcribing.";

function monthlyCapHours(): number {
  const n = Number(process.env.TRANSCRIPTION_MONTHLY_HOURS);
  return Number.isFinite(n) && n > 0 ? n : 50;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Transcription failed";
}

export async function requestTranscript(
  documentId: string,
  opts?: { replaceCorrections?: boolean },
): Promise<RequestTranscriptResult> {
  const userId = await requirePermission("documents.transcribe");
  await assertChildMatterAccess("document", documentId);

  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      name: true,
      contentType: true,
      fileUrl: true,
      matterId: true,
      leadId: true,
    },
  });
  if (!doc) return { ok: false, error: "Document not found." };
  const renderer = resolveDocumentRenderer(doc.contentType, doc.name);
  if ((renderer !== "audio" && renderer !== "video") || !doc.fileUrl) {
    return { ok: false, error: "Only audio and video can be transcribed." };
  }
  if (!transcriptionConfigured()) {
    return { ok: false, error: "Transcription isn't set up yet." };
  }

  const scope = scopeOf(doc);
  const viewerPath = `${scopeBasePath(scope)}/documents/${doc.id}`;
  const activity = { matterId: doc.matterId, leadId: doc.leadId, userId };

  const existing = await prisma.transcript.findUnique({
    where: { documentId },
    select: { status: true, correctedAt: true },
  });
  if (existing && IN_FLIGHT.includes(existing.status)) {
    return { ok: false, error: ALREADY };
  }
  if (existing?.correctedAt && !opts?.replaceCorrections) {
    return {
      ok: false,
      needsConfirm: "replace_corrections",
      error: "This replaces the corrections made to the transcript.",
    };
  }

  // Reuse: the same stored file already transcribed in this scope.
  const source = await prisma.transcript.findFirst({
    where: {
      status: "completed",
      documentId: { not: documentId },
      document: { fileUrl: doc.fileUrl, ...scopeWhere(scope) },
    },
    orderBy: { completedAt: "desc" },
    include: { segments: { orderBy: { index: "asc" } } },
  });
  if (source) {
    const now = new Date();
    const copied = await prisma.$transaction(async (tx) => {
      const fields = {
        status: "completed",
        provider: "copy",
        providerJobId: null,
        webhookSecret: null,
        language: source.language,
        durationSeconds: source.durationSeconds,
        speakers: source.speakers ?? {},
        correctedAt: source.correctedAt,
        correctedById: source.correctedById,
        error: null,
        requestedById: userId,
        requestedAt: now,
        completedAt: now,
      };
      let transcriptId: string;
      if (existing) {
        // Guard against a request that slipped in since the read above.
        const res = await tx.transcript.updateMany({
          where: { documentId, status: { notIn: IN_FLIGHT } },
          data: fields,
        });
        if (res.count === 0) return false;
        const row = await tx.transcript.findUniqueOrThrow({
          where: { documentId },
          select: { id: true },
        });
        transcriptId = row.id;
        await tx.transcriptSegment.deleteMany({ where: { transcriptId } });
      } else {
        const row = await tx.transcript.create({
          data: { documentId, ...fields },
          select: { id: true },
        });
        transcriptId = row.id;
      }
      if (source.segments.length > 0) {
        await tx.transcriptSegment.createMany({
          data: source.segments.map((s) => ({
            transcriptId,
            index: s.index,
            speaker: s.speaker,
            startSeconds: s.startSeconds,
            endSeconds: s.endSeconds,
            text: s.text,
            words: s.words ?? [],
            originalText: s.originalText,
          })),
        });
      }
      return true;
    });
    if (!copied) return { ok: false, error: ALREADY };
    await logActivity({
      ...activity,
      type: "document",
      title: "Transcript copied",
      detail: doc.name,
    });
    revalidatePath(viewerPath);
    return { ok: true, status: "completed" };
  }

  // Monthly budget (firm-wide; copies cost nothing).
  const since = monthStart(new Date(), DEFAULT_TIME_ZONE);
  const used = await prisma.transcript.aggregate({
    _sum: { durationSeconds: true },
    where: { completedAt: { gte: since }, provider: { not: "copy" } },
  });
  const capHours = monthlyCapHours();
  if (capExceeded(used._sum.durationSeconds ?? 0, capHours)) {
    return {
      ok: false,
      error: `This month's transcription limit (${capHours} hours) is used up.`,
    };
  }

  // Claim the job row (atomically refusing a concurrent request).
  const webhookSecret = randomBytes(24).toString("hex");
  const fresh = {
    status: "queued",
    provider: "assemblyai",
    providerJobId: null,
    webhookSecret,
    error: null,
    requestedById: userId,
    requestedAt: new Date(),
    completedAt: null,
  };
  if (existing) {
    const res = await prisma.transcript.updateMany({
      where: { documentId, status: { notIn: IN_FLIGHT } },
      data: fresh,
    });
    if (res.count === 0) return { ok: false, error: ALREADY };
  } else {
    try {
      await prisma.transcript.create({ data: { documentId, ...fresh } });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        return { ok: false, error: ALREADY };
      }
      throw err;
    }
  }

  const failJob = async (message: string): Promise<RequestTranscriptResult> => {
    await prisma.transcript.updateMany({
      where: { documentId, webhookSecret },
      data: { status: "failed", error: message, webhookSecret: null },
    });
    revalidatePath(viewerPath);
    return { ok: false, error: message };
  };

  let jobId: string;
  try {
    let audioUrl: string;
    if (activeStorageDriver() === "local") {
      const bytes = await readStoredFile(doc.fileUrl);
      if (!bytes) return failJob("The recording could not be read.");
      audioUrl = await uploadBytes(bytes);
    } else {
      audioUrl = await signedBlobUrl(doc.fileUrl, { media: true });
    }
    const origin = process.env.AUTH_URL?.replace(/\/+$/, "");
    const webhookUrl =
      activeStorageDriver() !== "local" && origin
        ? `${origin}/api/webhooks/assemblyai`
        : null;
    ({ jobId } = await submitJob({ audioUrl, webhookUrl, webhookSecret }));
  } catch (err) {
    return failJob(errMessage(err));
  }

  await prisma.transcript.updateMany({
    where: { documentId, webhookSecret },
    data: { status: "processing", providerJobId: jobId },
  });
  await logActivity({
    ...activity,
    type: "document",
    title: "Transcription requested",
    detail: doc.name,
  });
  revalidatePath(viewerPath);
  return { ok: true, status: "processing" };
}

export async function deleteTranscript(
  documentId: string,
): Promise<{ ok: boolean; error?: string }> {
  const userId = await requirePermission("documents.transcript.delete");
  await assertChildMatterAccess("document", documentId);

  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true, name: true, matterId: true, leadId: true },
  });
  if (!doc) return { ok: false, error: "Document not found." };
  const t = await prisma.transcript.findUnique({
    where: { documentId },
    select: { id: true, status: true, providerJobId: true },
  });
  if (!t) return { ok: false, error: "No transcript to delete." };

  await prisma.transcript.deleteMany({ where: { id: t.id } });
  if (IN_FLIGHT.includes(t.status) && t.providerJobId) {
    await deleteJob(t.providerJobId); // best effort; never throws
  }
  await logActivity({
    matterId: doc.matterId,
    leadId: doc.leadId,
    userId,
    type: "document",
    title: "Transcript deleted",
    detail: doc.name,
  });
  revalidatePath(`${scopeBasePath(scopeOf(doc))}/documents/${doc.id}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------

export type SegmentEditResult =
  | { ok: true; revision: number }
  | { ok: false; error: string; conflict?: true };

const CONFLICT: SegmentEditResult = {
  ok: false,
  conflict: true,
  error: "Someone else changed this paragraph. Reload to see their version.",
};
const MAX_PARAGRAPH_CHARS = 5000;

type SegmentContext = {
  userId: string;
  seg: {
    id: string;
    transcriptId: string;
    speaker: string;
    text: string;
    words: unknown;
    originalText: string | null;
  };
  transcript: { id: string; status: string; speakers: unknown };
  doc: { id: string; name: string; matterId: string | null; leadId: string | null };
  viewerPath: string;
};

function speakerMap(raw: unknown): Record<string, string> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? { ...(raw as Record<string, string>) }
    : {};
}

/** Permission + scope check for an edit on a segment. Returns an error result or the context. */
async function loadSegmentForEdit(
  segmentId: string,
): Promise<SegmentContext | { error: SegmentEditResult }> {
  const userId = await requirePermission("documents.transcript.edit");
  const seg = await prisma.transcriptSegment.findUnique({
    where: { id: segmentId },
    select: {
      id: true,
      transcriptId: true,
      speaker: true,
      text: true,
      words: true,
      originalText: true,
      transcript: {
        select: {
          id: true,
          status: true,
          speakers: true,
          document: {
            select: { id: true, name: true, matterId: true, leadId: true },
          },
        },
      },
    },
  });
  if (!seg) return { error: { ok: false, error: "Paragraph not found." } };
  const { document: doc, ...transcript } = seg.transcript;
  await assertChildMatterAccess("document", doc.id);
  if (transcript.status !== "completed") {
    return { error: { ok: false, error: "The transcript isn't ready to edit." } };
  }
  return {
    userId,
    seg,
    transcript,
    doc,
    viewerPath: `${scopeBasePath(scopeOf(doc))}/documents/${doc.id}`,
  };
}

const NOT_READY: SegmentEditResult = {
  ok: false,
  error: "The transcript isn't ready to edit.",
};

/**
 * Revision-checked segment write plus transcript corrected stamp, in one
 * transaction. The transcript row is locked first so status and the speakers
 * map are read fresh and concurrent speaker edits serialize.
 */
async function writeSegment(
  ctx: SegmentContext,
  revision: number,
  data: Prisma.TranscriptSegmentUpdateManyMutationInput,
  speakerLabel?: string,
): Promise<SegmentEditResult> {
  const result = await prisma.$transaction(
    async (tx): Promise<SegmentEditResult> => {
      await tx.$queryRaw`SELECT id FROM transcripts WHERE id = ${ctx.transcript.id} FOR UPDATE`;
      const fresh = await tx.transcript.findUniqueOrThrow({
        where: { id: ctx.transcript.id },
        select: { status: true, speakers: true },
      });
      if (fresh.status !== "completed") return NOT_READY;
      let speakers: Prisma.InputJsonValue | undefined;
      if (speakerLabel !== undefined) {
        const map = speakerMap(fresh.speakers);
        if (!Object.hasOwn(map, speakerLabel)) {
          if (!/^[A-Z]$/.test(speakerLabel)) {
            return { ok: false, error: "Unknown speaker." };
          }
          speakers = { ...map, [speakerLabel]: `Speaker ${speakerLabel}` };
        }
      }
      const res = await tx.transcriptSegment.updateMany({
        where: { id: ctx.seg.id, revision },
        data: { ...data, revision: { increment: 1 } },
      });
      if (res.count === 0) return CONFLICT;
      await tx.transcript.update({
        where: { id: ctx.transcript.id },
        data: {
          ...(speakers ? { speakers } : {}),
          correctedAt: new Date(),
          correctedBy: { connect: { id: ctx.userId } },
        },
      });
      return { ok: true, revision: revision + 1 };
    },
  );
  if (result.ok) revalidatePath(ctx.viewerPath);
  return result;
}

function logCorrection(ctx: SegmentContext, title: string) {
  return logActivity({
    matterId: ctx.doc.matterId,
    leadId: ctx.doc.leadId,
    userId: ctx.userId,
    type: "document",
    title,
    detail: ctx.doc.name,
  });
}

export async function updateTranscriptSegment(
  segmentId: string,
  input: { text: string; revision: number },
): Promise<SegmentEditResult> {
  const ctx = await loadSegmentForEdit(segmentId);
  if ("error" in ctx) return ctx.error;
  const text = input.text.trim();
  if (!text) return { ok: false, error: "A paragraph can't be empty." };
  if (text.length > MAX_PARAGRAPH_CHARS) {
    return { ok: false, error: "A paragraph can be at most 5,000 characters." };
  }
  const words = alignWords((ctx.seg.words as Word[]) ?? [], text);
  if (words.length === 0) return { ok: false, error: "A paragraph can't be empty." };
  const res = await writeSegment(ctx, input.revision, {
    text: wordsToText(words),
    words,
    // Only the first edit records the provider's text.
    ...(ctx.seg.originalText === null ? { originalText: ctx.seg.text } : {}),
  });
  if (res.ok) await logCorrection(ctx, "Transcript corrected");
  return res;
}

export async function revertTranscriptSegment(
  segmentId: string,
  revision: number,
): Promise<SegmentEditResult> {
  const ctx = await loadSegmentForEdit(segmentId);
  if ("error" in ctx) return ctx.error;
  if (ctx.seg.originalText === null) return { ok: true, revision };
  const words = alignWords((ctx.seg.words as Word[]) ?? [], ctx.seg.originalText);
  const res = await writeSegment(ctx, revision, {
    text: ctx.seg.originalText,
    words,
    originalText: null,
  });
  if (res.ok) await logCorrection(ctx, "Transcript paragraph reverted");
  return res;
}

export async function setSegmentSpeaker(
  segmentId: string,
  speaker: string,
  revision: number,
): Promise<SegmentEditResult> {
  const ctx = await loadSegmentForEdit(segmentId);
  if ("error" in ctx) return ctx.error;
  const res = await writeSegment(ctx, revision, { speaker }, speaker);
  if (res.ok) await logCorrection(ctx, "Transcript speaker changed");
  return res;
}

export async function renameTranscriptSpeaker(
  transcriptId: string,
  speaker: string,
  name: string,
): Promise<{ ok: boolean; error?: string }> {
  const userId = await requirePermission("documents.transcript.edit");
  const t = await prisma.transcript.findUnique({
    where: { id: transcriptId },
    select: {
      id: true,
      status: true,
      document: { select: { id: true, name: true, matterId: true, leadId: true } },
    },
  });
  if (!t) return { ok: false, error: "Transcript not found." };
  const doc = t.document;
  await assertChildMatterAccess("document", doc.id);
  if (t.status !== "completed") {
    return { ok: false, error: "The transcript isn't ready to edit." };
  }
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 60) {
    return { ok: false, error: "Names must be 1 to 60 characters." };
  }
  const found = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM transcripts WHERE id = ${t.id} FOR UPDATE`;
    const fresh = await tx.transcript.findUniqueOrThrow({
      where: { id: t.id },
      select: { status: true, speakers: true },
    });
    if (fresh.status !== "completed") return "not_ready" as const;
    const speakers = speakerMap(fresh.speakers);
    if (!Object.hasOwn(speakers, speaker)) return false;
    speakers[speaker] = trimmed;
    await tx.transcript.update({
      where: { id: t.id },
      data: {
        speakers,
        correctedAt: new Date(),
        correctedBy: { connect: { id: userId } },
      },
    });
    return true;
  });
  if (found === "not_ready") {
    return { ok: false, error: "The transcript isn't ready to edit." };
  }
  if (!found) return { ok: false, error: "Unknown speaker." };
  await logActivity({
    matterId: doc.matterId,
    leadId: doc.leadId,
    userId,
    type: "document",
    title: "Transcript speaker renamed",
    detail: doc.name,
  });
  revalidatePath(`${scopeBasePath(scopeOf(doc))}/documents/${doc.id}`);
  return { ok: true };
}
