/**
 * Transcript read path — the ONLY way the viewer loads a transcript.
 * Access is asserted through the document's scope first (matter wall /
 * lead scope, ADR-039), so a user who can't open the document gets the
 * same not-found/redirect it does and never learns a transcript exists.
 */

import { prisma } from "@/lib/prisma";
import { assertChildMatterAccess } from "@/lib/matter-access";
import type { Word } from "@/lib/transcription/types";

export type TranscriptStatus = "queued" | "processing" | "completed" | "failed";

export type TranscriptSegmentView = {
  id: string;
  index: number;
  speaker: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
  words: Word[];
  originalText: string | null;
  revision: number;
};

export type TranscriptView = {
  id: string;
  status: TranscriptStatus;
  error: string | null;
  durationSeconds: number | null;
  completedAt: Date | null;
  correctedAt: Date | null;
  correctedByName: string | null;
  speakers: Record<string, string>;
  segments: TranscriptSegmentView[];
};

export async function getDocumentTranscript(
  documentId: string,
): Promise<TranscriptView | null> {
  await assertChildMatterAccess("document", documentId);
  const t = await prisma.transcript.findUnique({
    where: { documentId },
    select: {
      id: true,
      status: true,
      error: true,
      durationSeconds: true,
      completedAt: true,
      correctedAt: true,
      speakers: true,
      correctedBy: { select: { name: true } },
      segments: {
        orderBy: { index: "asc" },
        select: {
          id: true,
          index: true,
          speaker: true,
          startSeconds: true,
          endSeconds: true,
          text: true,
          words: true,
          originalText: true,
          revision: true,
        },
      },
    },
  });
  if (!t) return null;
  const speakers =
    t.speakers && typeof t.speakers === "object" && !Array.isArray(t.speakers)
      ? (t.speakers as Record<string, string>)
      : {};
  return {
    id: t.id,
    status: t.status as TranscriptStatus,
    error: t.error,
    durationSeconds: t.durationSeconds,
    completedAt: t.completedAt,
    correctedAt: t.correctedAt,
    correctedByName: t.correctedBy?.name ?? null,
    speakers,
    segments: t.segments.map((s) => ({
      ...s,
      words: Array.isArray(s.words) ? (s.words as unknown as Word[]) : [],
    })),
  };
}

/**
 * Document name + caption (matter name, or the intake lead's name) for
 * the export header. Asserts access to the document itself, so it is
 * safe to call on its own.
 */
export async function getTranscriptCaption(
  documentId: string,
): Promise<{ documentName: string; caption: string } | null> {
  await assertChildMatterAccess("document", documentId);
  const d = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      name: true,
      matter: { select: { name: true } },
      lead: { select: { name: true } },
    },
  });
  if (!d) return null;
  return {
    documentName: d.name,
    caption: d.matter?.name ?? d.lead?.name ?? "",
  };
}
