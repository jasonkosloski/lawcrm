/**
 * Matter Documents — full-page document viewer.
 *
 * Renders one discovery file inline: PDF (iframe), images
 * (click-to-zoom), video/audio (Range-streamed with a playback-rate
 * control for long recordings), Word .docx (server-side mammoth →
 * sanitized HTML on a paper sheet), text/CSV (capped read, table
 * when the CSV parses cleanly). Everything else — and every
 * conversion failure — gets a graceful download card.
 *
 * Server component. The document is loaded scoped to the matter in
 * the URL (`getDocumentForViewer`) — a documentId that belongs to a
 * different matter 404s. Bytes are served by
 * `/api/documents/[id]/download` (session-gated, Range-capable);
 * docx/text previews read through the storage adapter directly.
 *
 * Chrome: breadcrumb back to the Documents tab preserving the doc's
 * folder (`?folder=...`), name + category/status chips + size +
 * uploader/date, Download, and prev/next through the same folder's
 * documents ordered by name (neighbors resolved server-side).
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { getDocumentForViewer } from "@/lib/queries/document-viewer";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { formatDate } from "@/lib/format-date";
import {
  parseCsvPreview,
  readStoredTextPreview,
  renderStoredDocxToSafeHtml,
} from "@/lib/document-preview";
import { resolveDocumentRenderer } from "@/components/documents-viewer/resolve-renderer";
import { ViewerFallbackCard } from "@/components/documents-viewer/fallback-card";
import { PdfViewer } from "@/components/documents-viewer/pdf-viewer";
import { ImageViewer } from "@/components/documents-viewer/image-viewer";
import { VideoPlayer } from "@/components/documents-viewer/video-player";
import { AudioPlayer } from "@/components/documents-viewer/audio-player";
import { DocxViewer } from "@/components/documents-viewer/docx-viewer";
import {
  CsvTablePreview,
  TextPreview,
} from "@/components/documents-viewer/text-preview";

// Viewer-local copies of the tab's display maps — the tab page is a
// separate feature surface; sharing would couple the two files.
const CATEGORY_LABEL: Record<string, string> = {
  filing: "Filing",
  pleading: "Pleading",
  correspondence: "Correspondence",
  contract: "Contract",
  intake: "Intake",
  discovery: "Discovery",
  expert_report: "Expert report",
  evidence: "Evidence",
  vendor: "Vendor",
  archive: "Archive",
  other: "Other",
};

const STATUS_META: Record<string, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-paper-2 text-ink-3 border-line" },
  filed: { label: "Filed", className: "bg-ok-soft text-ok border-line" },
  received: {
    label: "Received",
    className: "bg-brand-soft text-brand-700 border-brand-200",
  },
  review: {
    label: "Under review",
    className: "bg-warn-soft text-warn border-warn-border",
  },
  archived: {
    label: "Archived",
    className: "bg-paper-2 text-ink-4 border-line",
  },
};

const formatSize = (bytes: number | null): string => {
  if (bytes === null || bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default async function DocumentViewerPage({
  params,
}: PageProps<"/matters/[id]/documents/[documentId]">) {
  const { id, documentId } = await params;
  const [doc, tz] = await Promise.all([
    getDocumentForViewer(id, documentId),
    getCurrentUserTimeZone(),
  ]);
  if (!doc) notFound();

  const downloadHref = `/api/documents/${doc.id}/download`;
  // Back to the Documents tab, landing in this document's folder.
  const backHref = `/matters/${id}/documents${
    doc.folderId ? `?folder=${encodeURIComponent(doc.folderId)}` : ""
  }`;
  const status = STATUS_META[doc.status] ?? STATUS_META.active;

  const body = doc.fileUrl ? (
    await renderBody(doc.fileUrl, doc.contentType, doc, downloadHref)
  ) : (
    <ViewerFallbackCard
      title="No file attached"
      detail="This document row has no stored file — there is nothing to preview."
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-5 animate-page-enter">
      {/* ── Breadcrumb ─────────────────────────────────────────────── */}
      <div>
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-xs text-ink-3 hover:text-brand-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Documents
          {doc.folderName && (
            <span className="text-ink-4">/ {doc.folderName}</span>
          )}
        </Link>
      </div>

      {/* ── Viewer chrome ──────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="min-w-0 truncate text-sm font-semibold text-ink">
              {doc.name}
            </h1>
            <span className="inline-block rounded-full border border-line bg-paper-2 px-2 py-0.5 text-2xs font-medium text-ink-3">
              {CATEGORY_LABEL[doc.category] ?? doc.category}
            </span>
            <span
              className={`inline-block rounded-full border px-2 py-0.5 text-2xs font-medium ${status.className}`}
            >
              {status.label}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-2xs text-ink-4">
            <span className="font-mono">{formatSize(doc.fileSize)}</span>
            <span aria-hidden>·</span>
            <span>
              Uploaded
              {doc.uploadedByName
                ? ` by ${doc.uploadedByName}`
                : doc.uploadedByInitials
                  ? ` by ${doc.uploadedByInitials}`
                  : ""}{" "}
              {formatDate(doc.createdAt, "medium", tz)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <NeighborLink
            href={doc.prevId ? `/matters/${id}/documents/${doc.prevId}` : null}
            label="Previous document in folder"
            icon={<ChevronLeft className="h-4 w-4" aria-hidden />}
          />
          <NeighborLink
            href={doc.nextId ? `/matters/${id}/documents/${doc.nextId}` : null}
            label="Next document in folder"
            icon={<ChevronRight className="h-4 w-4" aria-hidden />}
          />
          {doc.fileUrl && (
            <a
              href={downloadHref}
              download={doc.name}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-white px-2.5 text-xs font-medium text-ink-2 transition-colors hover:border-brand-300 hover:text-brand-700"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              Download
            </a>
          )}
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col">{body}</div>
    </div>
  );
}

function NeighborLink({
  href,
  label,
  icon,
}: {
  href: string | null;
  label: string;
  icon: React.ReactNode;
}) {
  if (!href) {
    return (
      <span
        aria-disabled="true"
        title={label}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line bg-paper-2 text-ink-4 opacity-50"
      >
        {icon}
      </span>
    );
  }
  return (
    <Link
      href={href}
      title={label}
      aria-label={label}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line bg-white text-ink-2 transition-colors hover:border-brand-300 hover:text-brand-700"
    >
      {icon}
    </Link>
  );
}

/** Pick + build the body for a document that has stored bytes.
 *  docx/text/csv do their server-side reads here; failures come
 *  back as values (never throws) and render as fallback cards. */
async function renderBody(
  fileUrl: string,
  contentType: string | null,
  doc: { id: string; name: string; contentType: string | null; fileSize: number | null },
  downloadHref: string
): Promise<React.ReactNode> {
  const renderer = resolveDocumentRenderer(contentType, doc.name);
  switch (renderer) {
    case "pdf":
      return <PdfViewer src={downloadHref} name={doc.name} />;
    case "image":
      return <ImageViewer src={downloadHref} name={doc.name} />;
    case "video":
      return <VideoPlayer src={downloadHref} />;
    case "audio":
      return <AudioPlayer src={downloadHref} name={doc.name} />;
    case "docx": {
      const result = await renderStoredDocxToSafeHtml(fileUrl);
      if (!result.ok) {
        return (
          <ViewerFallbackCard
            title="Preview unavailable"
            detail={result.reason}
            downloadHref={downloadHref}
            downloadName={doc.name}
          />
        );
      }
      return <DocxViewer safeHtml={result.html} />;
    }
    case "text":
    case "csv": {
      const result = await readStoredTextPreview(fileUrl);
      if (!result.ok) {
        return (
          <ViewerFallbackCard
            title="Preview unavailable"
            detail={result.reason}
            downloadHref={downloadHref}
            downloadName={doc.name}
          />
        );
      }
      if (renderer === "csv") {
        // Table only when the CSV parses cleanly; a truncated read
        // usually cuts mid-row and falls back to the raw view.
        const rows = parseCsvPreview(result.text);
        if (rows) {
          return (
            <CsvTablePreview
              rows={rows}
              truncated={result.truncated}
              downloadHref={downloadHref}
            />
          );
        }
      }
      return (
        <TextPreview
          text={result.text}
          truncated={result.truncated}
          downloadHref={downloadHref}
        />
      );
    }
    case "doc_legacy":
      return (
        <ViewerFallbackCard
          title="Legacy Word format"
          detail="Inline preview supports .docx only. Download this .doc file to open it in Word, or re-save it as .docx and re-upload."
          downloadHref={downloadHref}
          downloadName={doc.name}
        />
      );
    default:
      return (
        <ViewerFallbackCard
          title="No inline preview for this file type"
          detail={`${doc.contentType ?? "Unknown type"} · ${formatSize(doc.fileSize)}. Download it to view.`}
          downloadHref={downloadHref}
          downloadName={doc.name}
        />
      );
  }
}
