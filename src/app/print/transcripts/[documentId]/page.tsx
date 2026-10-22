/**
 * Print Transcript — chrome-free, speaker-labeled transcript with
 * [hh:mm:ss] timecodes, for browser Save-as-PDF (same pattern as
 * /print/invoices/[id]). Renders a normalized `TranscriptExport`, the
 * single input every future export format shares.
 *
 * Auth: `requireUser()` first (this route sits outside the (dashboard)
 * layout, ADR-028), then `getDocumentTranscript`, which asserts document
 * access (matter wall / lead scope, ADR-039; a hidden document 404s).
 * 404 when there is no transcript or it isn't completed.
 * Dates are instants shown in the viewer's profile zone (ADR-012).
 */

import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintToolbar } from "@/components/matters/billing/print-toolbar";
import { requireUser } from "@/lib/current-user";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { formatDate } from "@/lib/format-date";
import { getDocumentTranscript, getTranscriptCaption } from "@/lib/queries/transcript";
import { exportNotice, toTranscriptExport } from "@/lib/transcription/export";
import { formatTimecode } from "@/lib/transcription/timecode";

const loadTranscript = cache(getDocumentTranscript);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ documentId: string }>;
}): Promise<Metadata> {
  await requireUser();
  const { documentId } = await params;
  const t = await loadTranscript(documentId);
  const cap = t ? await getTranscriptCaption(documentId) : null;
  return {
    // Browsers name the Save-as-PDF file after the title.
    title: cap ? `Transcript - ${cap.documentName}` : "Transcript",
    robots: { index: false, follow: false },
  };
}

/**
 * The notice and "Page N" live in @page margin boxes, which repeat on every
 * printed page and reserve their own space (a position:fixed footer would
 * sit over the text, and counter(page) only resolves in a margin box). The
 * notice is fixed export copy, never user input.
 */
function printCss(notice: string): string {
  const box = "font: 9pt sans-serif; color: #666;";
  return `@page {
  margin: 18mm 16mm 22mm;
  @bottom-left { content: ${JSON.stringify(notice)}; ${box} }
  @bottom-right { content: "Page " counter(page); ${box} }
}`;
}

export default async function PrintTranscriptPage({
  params,
  searchParams,
}: {
  params: Promise<{ documentId: string }>;
  searchParams: Promise<{ autoprint?: string }>;
}) {
  await requireUser();
  const { documentId } = await params;
  const view = await loadTranscript(documentId);
  if (!view || view.status !== "completed") notFound();
  const [sp, timeZone, cap] = await Promise.all([
    searchParams,
    getCurrentUserTimeZone(),
    getTranscriptCaption(documentId),
  ]);
  if (!cap) notFound();

  const exp = toTranscriptExport(view, cap);
  const notice = exportNotice(exp);

  return (
    <div className="min-h-screen bg-white">
      <PrintToolbar autoprint={sp.autoprint === "1"} />
      <main className="max-w-3xl mx-auto print:max-w-none print:mx-0 p-6 print:p-0 pb-8">
        <header className="mb-6 border-b border-line pb-4">
          {exp.caption && <p className="text-sm font-semibold text-ink">{exp.caption}</p>}
          <h1 className="font-serif text-xl text-ink">{exp.documentName}</h1>
          <p className="mt-1 text-xs text-ink-3">
            {exp.durationSeconds !== null && `Duration ${formatTimecode(exp.durationSeconds)} · `}
            Transcribed {formatDate(exp.transcribedAt, "long", timeZone)}
          </p>
          <p className="text-xs text-ink-3">
            {exp.corrected
              ? `Corrected by ${exp.corrected.by} on ${formatDate(exp.corrected.at, "long", timeZone)}`
              : notice}
          </p>
        </header>

        <div className="space-y-3">
          {exp.paragraphs.map((p, i) => (
            <p key={i} className="text-sm leading-relaxed text-ink break-inside-avoid">
              <span className="font-mono text-2xs text-ink-3">{p.timecode}</span>{" "}
              <span className="font-semibold">{p.speaker}:</span> {p.text}
            </p>
          ))}
        </div>
      </main>
      {/* On screen the notice sits under the transcript; in print it moves
          into the page margin (below), so nothing is ever overlaid. */}
      <p className="print:hidden max-w-3xl mx-auto px-6 pb-8 text-2xs text-ink-3">{notice}</p>
      <style dangerouslySetInnerHTML={{ __html: printCss(notice) }} />
    </div>
  );
}
