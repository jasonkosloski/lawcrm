/**
 * PdfReview — the ReviewPanel adapter for the PDF renderer.
 *
 * Capture: browsers expose NO API for reading the native PDF
 * plugin's current page out of an iframe, so "Flag a page" can't
 * prefill anything — the composer opens with a blank page-number
 * input the reviewer fills in (blank = flag the whole document).
 *
 * Navigate: clicking a page-anchored flag reloads the iframe with
 * `#page=N`. A plain src change is NOT enough — same-URL hash
 * changes don't re-trigger the plugin's navigation, so repeat
 * clicks to the same page would do nothing. State carries a
 * monotonically increasing token that keys the viewer, forcing a
 * remount (and thus a fresh `#page=N` load) on every click.
 * Trade-off: the plugin reloads the document per jump — acceptable
 * for a review-jump, and the bytes come Range-cached.
 */

"use client";

import { useState } from "react";
import { PdfViewer } from "@/components/documents-viewer/pdf-viewer";
import { ReviewPanel } from "./review-panel";
import type { ComposerAnchor } from "./flag-composer";
import type { RailMoment } from "./moments-rail";

export function PdfReview({
  src,
  name,
  documentId,
  initialPage,
  moments,
  currentUserId,
  canCreate,
  canEditAny,
  canDeleteAny,
}: {
  src: string;
  name: string;
  documentId: string;
  /** From the page's ?flag= deep link — open at this page. */
  initialPage: number | null;
  moments: RailMoment[];
  currentUserId: string;
  canCreate: boolean;
  canEditAny: boolean;
  canDeleteAny: boolean;
}) {
  const [nav, setNav] = useState<{ page: number; token: number } | null>(
    initialPage !== null ? { page: initialPage, token: 0 } : null
  );
  const [composerAnchor, setComposerAnchor] = useState<ComposerAnchor | null>(
    null
  );

  const navigate = (m: RailMoment) => {
    if (m.pageNumber === null) return;
    const page = m.pageNumber;
    setNav((prev) => ({ page, token: (prev?.token ?? 0) + 1 }));
  };

  return (
    <ReviewPanel
      documentId={documentId}
      moments={moments}
      currentUserId={currentUserId}
      canCreate={canCreate}
      canEditAny={canEditAny}
      canDeleteAny={canDeleteAny}
      captureLabel="Flag a page"
      // The plugin's current page is unreadable (see header) — the
      // composer's page input starts blank.
      captureAnchor={() => ({ kind: "page", pageNumber: null })}
      composerAnchor={composerAnchor}
      onComposerAnchorChange={setComposerAnchor}
      onNavigate={navigate}
      emptyHint="Hit “Flag a page” and note the page number — or flag the whole document."
    >
      <PdfViewer
        key={nav ? `p${nav.page}-${nav.token}` : "initial"}
        src={nav ? `${src}#page=${nav.page}` : src}
        name={name}
      />
    </ReviewPanel>
  );
}
