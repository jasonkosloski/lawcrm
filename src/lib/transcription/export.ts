/**
 * Normalized transcript export. Every export format (timecode PDF today;
 * page:line PDF, .docx, captions later) renders this one shape, so
 * adding a format never touches the transcript model.
 */

import type { TranscriptView } from "@/lib/queries/transcript";
import { formatTimecode } from "./timecode";

export type TranscriptExport = {
  title: string;
  caption: string;
  documentName: string;
  durationSeconds: number | null;
  transcribedAt: Date;
  corrected: { by: string; at: Date } | null;
  paragraphs: { speaker: string; timecode: string; text: string }[];
};

export const UNCORRECTED_NOTICE = "Uncorrected machine transcript";
export const CORRECTED_NOTICE = "Machine transcript, corrected by staff";

export function toTranscriptExport(
  view: TranscriptView,
  ctx: { caption: string; documentName: string; now?: Date },
): TranscriptExport {
  return {
    title: `Transcript of ${ctx.documentName}`,
    caption: ctx.caption,
    documentName: ctx.documentName,
    durationSeconds: view.durationSeconds,
    transcribedAt: view.completedAt ?? ctx.now ?? new Date(),
    corrected: view.correctedAt
      ? { by: view.correctedByName ?? "staff", at: view.correctedAt }
      : null,
    paragraphs: view.segments.map((s) => ({
      speaker: view.speakers[s.speaker] ?? `Speaker ${s.speaker}`,
      timecode: `[${formatTimecode(s.startSeconds)}]`,
      text: s.text,
    })),
  };
}

export function exportNotice(e: Pick<TranscriptExport, "corrected">): string {
  return e.corrected ? CORRECTED_NOTICE : UNCORRECTED_NOTICE;
}
