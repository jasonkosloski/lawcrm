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
 *
 * Evidence review: EVERY renderer wraps in a ReviewPanel adapter —
 * MediaReview (time anchors), PdfReview (page anchors), TextReview
 * (quote anchors on the rendered docx/text/CSV body), and
 * DocumentReview (anchorless) for images and fallback cards. Flags
 * come from `getDocumentFlaggedMoments`; creation gates on
 * `evidence.flag.create`.
 *
 * Deep links: `?flag={id}` resolves the flag server-side (from the
 * already-fetched rail list) and hands its anchor to the adapter —
 * seek for time, `#page=N` for page, scroll-to-highlight for quote.
 * The Evidence tab's original `?t=SECONDS` format still works for
 * media.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { getDocumentForViewer } from "@/lib/queries/document-viewer";
import { getDocumentFlaggedMoments } from "@/lib/queries/evidence";
import { getCurrentUserId } from "@/lib/current-user";
import { currentUserHasPermission } from "@/lib/permission-check";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { MAX_MEDIA_SECONDS } from "@/lib/media-time";
import { formatDate } from "@/lib/format-date";
import {
  parseCsvPreview,
  readStoredTextPreview,
  renderStoredDocxToSafeHtml,
} from "@/lib/document-preview";
import { resolveDocumentRenderer } from "@/components/documents-viewer/resolve-renderer";
import { ViewerFallbackCard } from "@/components/documents-viewer/fallback-card";
import { ImageViewer } from "@/components/documents-viewer/image-viewer";
import { MediaReview } from "@/components/evidence/media-review";
import { PdfReview } from "@/components/evidence/pdf-review";
import { TextReview } from "@/components/evidence/text-review";
import { DocumentReview } from "@/components/evidence/document-review";
import type { RailMoment } from "@/components/evidence/moments-rail";
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

const firstParam = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

export default async function DocumentViewerPage({
  params,
  searchParams,
}: PageProps<"/matters/[id]/documents/[documentId]">) {
  const { id, documentId } = await params;
  const [doc, tz] = await Promise.all([
    getDocumentForViewer(id, documentId),
    getCurrentUserTimeZone(),
  ]);
  if (!doc) notFound();

  const sp = await searchParams;
  // ?t=SECONDS — the original media deep-link format, still honored.
  const rawT = firstParam(sp.t);
  const parsedT = typeof rawT === "string" ? Number(rawT) : NaN;
  const tSeconds =
    Number.isFinite(parsedT) && parsedT >= 0 && parsedT <= MAX_MEDIA_SECONDS
      ? parsedT
      : null;
  // ?flag=ID — anchor deep link for every kind, resolved below once
  // the flag list is loaded.
  const flagParam = firstParam(sp.flag) ?? null;

  const downloadHref = `/api/documents/${doc.id}/download`;
  // Back to the Documents tab, landing in this document's folder.
  const backHref = `/matters/${id}/documents${
    doc.folderId ? `?folder=${encodeURIComponent(doc.folderId)}` : ""
  }`;
  const status = STATUS_META[doc.status] ?? STATUS_META.active;

  // Evidence-review data — every renderer flags now, so fetch
  // whenever there's an actual file to review.
  const renderer = doc.fileUrl
    ? resolveDocumentRenderer(doc.contentType, doc.name)
    : null;
  let review: ReviewData | null = null;
  if (renderer) {
    const [flags, currentUserId, canCreate, canEditAny, canDeleteAny] =
      await Promise.all([
        getDocumentFlaggedMoments(doc.id),
        getCurrentUserId(),
        currentUserHasPermission("evidence.flag.create"),
        currentUserHasPermission("evidence.flag.edit_any"),
        currentUserHasPermission("evidence.flag.delete_any"),
      ]);
    // Resolve ?flag= against the rail list (server-side) — its
    // anchor becomes the adapter's initial navigation. A stale id
    // (deleted flag, wrong document) simply resolves to nothing.
    const linked = flagParam ? flags.find((f) => f.id === flagParam) : undefined;
    review = {
      currentUserId,
      canCreate,
      canEditAny,
      canDeleteAny,
      initialSeconds: linked?.timeSeconds ?? tSeconds,
      initialPage: linked?.pageNumber ?? null,
      initialQuote: linked?.quote ?? null,
      moments: flags.map((f) => ({
        id: f.id,
        timeSeconds: f.timeSeconds,
        endSeconds: f.endSeconds,
        pageNumber: f.pageNumber,
        quote: f.quote,
        category: f.category,
        description: f.description,
        flaggedById: f.flaggedById,
        flaggedByInitials: f.flaggedByInitials,
        flaggedByName: f.flaggedByName,
      })),
    };
  }

  const body =
    renderer && review ? (
      await renderBody(doc.fileUrl!, renderer, doc, downloadHref, review)
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

/** Everything the review adapters need beyond src/name — assembled
 *  by the page for every renderer that has stored bytes. The
 *  initial* fields carry the resolved ?flag= / ?t= deep link; each
 *  adapter consumes the one that matches its anchor kind. */
type ReviewData = {
  currentUserId: string;
  canCreate: boolean;
  canEditAny: boolean;
  canDeleteAny: boolean;
  initialSeconds: number | null;
  initialPage: number | null;
  initialQuote: string | null;
  moments: RailMoment[];
};

/** Pick + build the body for a document that has stored bytes.
 *  docx/text/csv do their server-side reads here; failures come
 *  back as values (never throws) and render as fallback cards
 *  (inside the anchorless DocumentReview so existing flags still
 *  list). Every branch wraps in its renderer's review adapter. */
async function renderBody(
  fileUrl: string,
  renderer: ReturnType<typeof resolveDocumentRenderer>,
  doc: { id: string; name: string; contentType: string | null; fileSize: number | null },
  downloadHref: string,
  review: ReviewData
): Promise<React.ReactNode> {
  const shared = {
    documentId: doc.id,
    moments: review.moments,
    currentUserId: review.currentUserId,
    canCreate: review.canCreate,
    canEditAny: review.canEditAny,
    canDeleteAny: review.canDeleteAny,
  };

  switch (renderer) {
    case "pdf":
      return (
        <PdfReview
          src={downloadHref}
          name={doc.name}
          initialPage={review.initialPage}
          {...shared}
        />
      );
    case "image":
      return (
        <DocumentReview {...shared}>
          <ImageViewer src={downloadHref} name={doc.name} />
        </DocumentReview>
      );
    case "video":
    case "audio":
      return (
        <MediaReview
          kind={renderer}
          src={downloadHref}
          name={doc.name}
          initialSeconds={review.initialSeconds}
          {...shared}
        />
      );
    case "docx": {
      const result = await renderStoredDocxToSafeHtml(fileUrl);
      if (!result.ok) {
        return (
          <DocumentReview {...shared}>
            <ViewerFallbackCard
              title="Preview unavailable"
              detail={result.reason}
              downloadHref={downloadHref}
              downloadName={doc.name}
            />
          </DocumentReview>
        );
      }
      return (
        <TextReview initialQuote={review.initialQuote} {...shared}>
          <DocxViewer safeHtml={result.html} />
        </TextReview>
      );
    }
    case "text":
    case "csv": {
      const result = await readStoredTextPreview(fileUrl);
      if (!result.ok) {
        return (
          <DocumentReview {...shared}>
            <ViewerFallbackCard
              title="Preview unavailable"
              detail={result.reason}
              downloadHref={downloadHref}
              downloadName={doc.name}
            />
          </DocumentReview>
        );
      }
      let preview: React.ReactNode = (
        <TextPreview
          text={result.text}
          truncated={result.truncated}
          downloadHref={downloadHref}
        />
      );
      if (renderer === "csv") {
        // Table only when the CSV parses cleanly; a truncated read
        // usually cuts mid-row and falls back to the raw view.
        const rows = parseCsvPreview(result.text);
        if (rows) {
          preview = (
            <CsvTablePreview
              rows={rows}
              truncated={result.truncated}
              downloadHref={downloadHref}
            />
          );
        }
      }
      return (
        <TextReview initialQuote={review.initialQuote} {...shared}>
          {preview}
        </TextReview>
      );
    }
    case "doc_legacy":
      return (
        <DocumentReview {...shared}>
          <ViewerFallbackCard
            title="Legacy Word format"
            detail="Inline preview supports .docx only. Download this .doc file to open it in Word, or re-save it as .docx and re-upload."
            downloadHref={downloadHref}
            downloadName={doc.name}
          />
        </DocumentReview>
      );
    default:
      return (
        <DocumentReview {...shared}>
          <ViewerFallbackCard
            title="No inline preview for this file type"
            detail={`${doc.contentType ?? "Unknown type"} · ${formatSize(doc.fileSize)}. Download it to view.`}
            downloadHref={downloadHref}
            downloadName={doc.name}
          />
        </DocumentReview>
      );
  }
}
