"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permission-check";
import { assertChildMatterAccess } from "@/lib/matter-access";
import { logActivity } from "@/lib/activity-log";
import { activeStorageDriver, readStoredFile, signedBlobUrl } from "@/lib/file-storage";
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
import { stripUrls } from "@/lib/transcription/sanitize";
import type { Word } from "@/lib/transcription/types";
import { reassignSpeakerRange, type WordPoint } from "@/lib/transcription/speaker-range";
import { isUniqueViolation } from "@/lib/prisma-errors";

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
  return stripUrls(err instanceof Error ? err.message : "Transcription failed");
}

/**
 * Where the provider can reach our webhook, or null when no public origin is
 * known (the sweep then finishes the job). Only used when the recording is
 * fetched by URL; local-storage dev uploads bytes and has no public origin.
 */
function webhookOrigin(): string | null {
  if (activeStorageDriver() === "local") return null;
  const configured = process.env.AUTH_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return vercel ? `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}` : null;
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
    select: { status: true, correctedAt: true, completedAt: true },
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

  // Reuse: the same stored file already transcribed in this scope. Only when
  // there is nothing of this document's own to replace: re-running over an
  // existing transcript means "transcribe again", and a sibling's (possibly
  // corrected) copy would silently undo that. A failed row that never
  // completed has nothing of its own either.
  const mayReuse = !existing || (existing.status === "failed" && !existing.completedAt);
  const source = !mayReuse
    ? null
    : await prisma.transcript.findFirst({
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
      if (isUniqueViolation(err)) {
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
    const origin = webhookOrigin();
    const webhookUrl = origin ? `${origin}/api/webhooks/assemblyai` : null;
    ({ jobId } = await submitJob({ audioUrl, webhookUrl, webhookSecret }));
  } catch (err) {
    return failJob(errMessage(err));
  }

  const claimed = await prisma.transcript.updateMany({
    where: { documentId, webhookSecret },
    data: { status: "processing", providerJobId: jobId },
  });
  if (claimed.count === 0) {
    // The transcript was deleted (or replaced) between the claim and the
    // submit: the provider job is an orphan nobody will finish or delete.
    if (!(await deleteJob(jobId))) {
      await prisma.transcriptPurge.upsert({
        where: { providerJobId: jobId },
        create: { providerJobId: jobId },
        update: {},
      });
    }
    return { ok: false, error: "The transcript was removed while it was starting." };
  }
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
  // In-flight jobs are queued for provider deletion by the transcripts
  // BEFORE DELETE trigger (transcript_purges); a finished row normally
  // has no job id left, so this is a best-effort no-op.
  if (t.status === "completed" && t.providerJobId) {
    await deleteJob(t.providerJobId);
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
  | {
      ok: false;
      error: string;
      conflict?: true;
      /** On a conflict: the paragraph as it is now, so the UI can show it. */
      current?: { text: string; revision: number };
    };

function conflictResult(current?: { text: string; revision: number }): SegmentEditResult {
  return {
    ok: false,
    conflict: true,
    error: "Someone else changed this paragraph. Reload to see their version.",
    ...(current ? { current } : {}),
  };
}
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
    revision: number;
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
  revision: number,
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
      revision: true,
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
  // A paragraph can vanish when a speaker change merges or splits it:
  // that's another editor's change, so treat it as a conflict (reload).
  if (!seg) {
    return {
      error: {
        ok: false,
        conflict: true,
        error: "This paragraph was changed by someone else. Reload to see the current version.",
      },
    };
  }
  const { document: doc, ...transcript } = seg.transcript;
  await assertChildMatterAccess("document", doc.id);
  if (transcript.status !== "completed") {
    return { error: { ok: false, error: "The transcript isn't ready to edit." } };
  }
  // The alignment base (words/text) and the revision must agree: a stale
  // client is a conflict before anything is computed from newer text.
  if (seg.revision !== revision) {
    return {
      error: conflictResult({ text: seg.text, revision: seg.revision }),
    };
  }
  return {
    userId,
    seg,
    transcript,
    doc,
    viewerPath: `${scopeBasePath(scopeOf(doc))}/documents/${doc.id}`,
  };
}

/**
 * Validate a speaker label against the transcript's map. An existing key is
 * used as is; an unused A-Z label is added as "Speaker X". Returns the map
 * to write (undefined when unchanged), or null for an invalid label.
 */
function resolveSpeakerLabel(
  map: Record<string, string>,
  label: string,
): { speakers: Prisma.InputJsonValue | undefined } | null {
  if (Object.hasOwn(map, label)) return { speakers: undefined };
  if (!/^[A-Z]$/.test(label)) return null;
  return { speakers: { ...map, [label]: `Speaker ${label}` } };
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
  const result = await prisma.$transaction(async (tx): Promise<SegmentEditResult> => {
    await tx.$queryRaw`SELECT id FROM transcripts WHERE id = ${ctx.transcript.id} FOR UPDATE`;
    const fresh = await tx.transcript.findUniqueOrThrow({
      where: { id: ctx.transcript.id },
      select: { status: true, speakers: true },
    });
    if (fresh.status !== "completed") return NOT_READY;
    let speakers: Prisma.InputJsonValue | undefined;
    if (speakerLabel !== undefined) {
      const resolved = resolveSpeakerLabel(speakerMap(fresh.speakers), speakerLabel);
      if (!resolved) return { ok: false, error: "Unknown speaker." };
      speakers = resolved.speakers;
    }
    const res = await tx.transcriptSegment.updateMany({
      where: { id: ctx.seg.id, revision },
      data: { ...data, revision: { increment: 1 } },
    });
    if (res.count === 0) {
      const now = await tx.transcriptSegment.findUnique({
        where: { id: ctx.seg.id },
        select: { text: true, revision: true },
      });
      return conflictResult(now ?? undefined);
    }
    await tx.transcript.update({
      where: { id: ctx.transcript.id },
      data: {
        ...(speakers ? { speakers } : {}),
        correctedAt: new Date(),
        correctedBy: { connect: { id: ctx.userId } },
      },
    });
    return { ok: true, revision: revision + 1 };
  });
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
  const ctx = await loadSegmentForEdit(segmentId, input.revision);
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
  const ctx = await loadSegmentForEdit(segmentId, revision);
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
  const ctx = await loadSegmentForEdit(segmentId, revision);
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

/**
 * Give a selected run of words to one speaker (the selection toolbar's
 * "Change speaker"). Partly selected paragraphs split, same-speaker
 * neighbours merge (src/lib/transcription/speaker-range.ts); words and
 * timings never change. Runs under the transcript row lock; every
 * paragraph in the selection must still be at the revision the client
 * saw, otherwise nothing is applied.
 *
 * Rows are kept where they can be, so ids (search hits, open editors)
 * and correction history survive:
 *   - a new paragraph with exactly one old paragraph's words updates that
 *     row in place (originalText kept);
 *   - whole old paragraphs merged together reuse the first row, with
 *     their originals joined when any had one;
 *   - only pieces cut from a paragraph are new rows (no original: it
 *     can't be split to match).
 * Every reused row's revision is bumped, so a stale editor conflicts.
 */
export async function changeSpeakerForSelection(
  transcriptId: string,
  input: {
    start: WordPoint;
    end: WordPoint;
    speaker: string;
    /** Revision the client saw for each paragraph in the selection. */
    revisions: Record<string, number>;
  },
): Promise<{ ok: true } | { ok: false; error: string; conflict?: true }> {
  const userId = await requirePermission("documents.transcript.edit");
  const isPoint = (p: unknown): p is WordPoint =>
    !!p &&
    typeof (p as WordPoint).segmentId === "string" &&
    Number.isInteger((p as WordPoint).word);
  if (
    !input ||
    !isPoint(input.start) ||
    !isPoint(input.end) ||
    typeof input.speaker !== "string" ||
    !input.revisions ||
    typeof input.revisions !== "object"
  ) {
    return { ok: false, error: "Invalid selection." };
  }
  const t = await prisma.transcript.findUnique({
    where: { id: transcriptId },
    select: {
      id: true,
      document: { select: { id: true, name: true, matterId: true, leadId: true } },
    },
  });
  if (!t) return { ok: false, error: "Transcript not found." };
  const doc = t.document;
  await assertChildMatterAccess("document", doc.id);

  const conflict = {
    ok: false as const,
    conflict: true as const,
    error: "Someone else changed this part of the transcript. Reload to see their version.",
  };

  type Result = { ok: true; changed: boolean } | { ok: false; error: string; conflict?: true };
  const result = await prisma.$transaction(async (tx): Promise<Result> => {
    await tx.$queryRaw`SELECT id FROM transcripts WHERE id = ${t.id} FOR UPDATE`;
    const fresh = await tx.transcript.findUniqueOrThrow({
      where: { id: t.id },
      select: { status: true, speakers: true },
    });
    if (fresh.status !== "completed")
      return { ok: false, error: "The transcript isn't ready to edit." };
    const resolved = resolveSpeakerLabel(speakerMap(fresh.speakers), input.speaker);
    if (!resolved) return { ok: false, error: "Unknown speaker." };

    // Order and revisions for every row (cheap); words only around the selection.
    const meta = await tx.transcriptSegment.findMany({
      where: { transcriptId: t.id },
      orderBy: { index: "asc" },
      select: { id: true, index: true, speaker: true, revision: true },
    });
    let p0 = meta.findIndex((r) => r.id === input.start.segmentId);
    let p1 = meta.findIndex((r) => r.id === input.end.segmentId);
    if (p0 < 0 || p1 < 0) return conflict;
    if (p0 > p1) [p0, p1] = [p1, p0];
    for (let p = p0; p <= p1; p++) {
      if (input.revisions[meta[p]!.id] !== meta[p]!.revision) return conflict;
    }
    const lo = Math.max(0, p0 - 1);
    const hi = Math.min(meta.length - 1, p1 + 1);
    const windowRows = await tx.transcriptSegment.findMany({
      where: { id: { in: meta.slice(lo, hi + 1).map((r) => r.id) } },
      orderBy: { index: "asc" },
      select: {
        id: true,
        index: true,
        speaker: true,
        text: true,
        words: true,
        originalText: true,
        revision: true,
      },
    });
    const rows = windowRows.map((r) => ({ ...r, words: (r.words as Word[]) ?? [] }));

    const plan = reassignSpeakerRange(rows, input.start, input.end, input.speaker);
    if (!plan) return conflict;
    if (plan.kind === "noop") return { ok: true, changed: false };

    const replaced = rows.slice(plan.from, plan.to + 1);
    // Which old row each word came from (the plan keeps word objects).
    const owner = new Map<Word, (typeof rows)[number]>();
    for (const r of replaced) for (const w of r.words) owner.set(w, r);

    const claimed = new Set<string>();
    const writes = plan.segments.map((seg) => {
      const owners = [...new Set(seg.words.map((w) => owner.get(w)!))];
      // Whole rows only: a row split across new paragraphs has more words
      // than this paragraph takes from it.
      const wholeRows =
        owners.every((o) => !claimed.has(o.id)) &&
        owners.reduce((n, o) => n + o.words.length, 0) === seg.words.length;
      if (!wholeRows) return { seg, reuse: null, originalText: null as string | null };
      for (const o of owners) claimed.add(o.id);
      const keep = owners[0]!;
      const originalText =
        owners.length === 1
          ? keep.originalText
          : owners.some((o) => o.originalText !== null)
            ? owners.map((o) => o.originalText ?? o.text).join(" ")
            : null;
      return { seg, reuse: keep, originalText };
    });

    const baseIndex = replaced[0]!.index;
    const delta = plan.segments.length - replaced.length;

    // Park everything from the replaced run onward at negative indices so
    // the (transcriptId, index) unique index never collides mid-rewrite.
    await tx.$executeRaw`UPDATE transcript_segments SET "index" = -"index" - 1 WHERE "transcriptId" = ${t.id} AND "index" >= ${baseIndex}`;
    const keptIds = new Set(writes.filter((w) => w.reuse).map((w) => w.reuse!.id));
    const drop = replaced.filter((r) => !keptIds.has(r.id)).map((r) => r.id);
    if (drop.length) await tx.transcriptSegment.deleteMany({ where: { id: { in: drop } } });
    for (const [k, w] of writes.entries()) {
      const data = {
        index: baseIndex + k,
        speaker: w.seg.speaker,
        startSeconds: w.seg.startSeconds,
        endSeconds: w.seg.endSeconds,
        text: w.seg.text,
        words: w.seg.words,
        originalText: w.originalText,
      };
      if (w.reuse) {
        await tx.transcriptSegment.update({
          where: { id: w.reuse.id },
          data: { ...data, revision: { increment: 1 } },
        });
      } else {
        await tx.transcriptSegment.create({ data: { transcriptId: t.id, ...data } });
      }
    }
    // Rows after the run return from parking, shifted by the size change.
    await tx.$executeRaw`UPDATE transcript_segments SET "index" = -"index" - 1 + ${delta} WHERE "transcriptId" = ${t.id} AND "index" < 0`;

    await tx.transcript.update({
      where: { id: t.id },
      data: {
        ...(resolved.speakers ? { speakers: resolved.speakers } : {}),
        correctedAt: new Date(),
        correctedBy: { connect: { id: userId } },
      },
    });
    return { ok: true, changed: true };
  });
  if (!result.ok) return result;
  if (result.changed) {
    await logActivity({
      matterId: doc.matterId,
      leadId: doc.leadId,
      userId,
      type: "document",
      title: "Transcript speaker changed",
      detail: doc.name,
    });
    revalidatePath(`${scopeBasePath(scopeOf(doc))}/documents/${doc.id}`);
  }
  return { ok: true };
}
