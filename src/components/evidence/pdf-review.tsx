/**
 * PdfReview — the ReviewPanel adapter for PDFs, on the built-in
 * pdf.js viewer (PdfDocumentViewer).
 *
 * Capture, two ways:
 *   - Select text on a page → a floating "Flag selection" button →
 *     a PAGE + QUOTE flag (the page the selection starts on, plus the
 *     selected text). The page disambiguates a phrase that appears on
 *     several pages; the composer warns when the passage repeats on
 *     that page, or can't be found again.
 *   - "Flag this page" → a page-only flag, prefilled with the page
 *     under the reading line (blank the page = whole document).
 *
 * Navigate: a flag with a quote scrolls to its page, relocates the
 * passage in that page's text layer (`locateQuote` — the same
 * whitespace/case-insensitive matcher the Word viewer uses) and
 * highlights it; a page-only flag just scrolls to the page. A passage
 * that no longer matches says so instead of failing silently.
 *
 * Every flagged passage on a rendered page also carries a soft,
 * persistent highlight, so the reviewer sees what's already tagged
 * while reading. Both highlights use the CSS Custom Highlight API
 * (no DOM changes to pdf.js's layer); browsers without it fall back
 * to selecting the clicked passage, and skip the persistent marks.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Flag, SearchX } from "lucide-react";
import {
  PdfDocumentViewer,
  type PdfViewerHandle,
} from "@/components/documents-viewer/pdf-document-viewer";
import { MAX_QUOTE_CHARS } from "@/lib/flag-anchor";
import { countQuoteOccurrences, locateQuote } from "@/lib/quote-locate";
import { ReviewPanel } from "./review-panel";
import type { ComposerAnchor } from "./flag-composer";
import type { RailMoment } from "./moments-rail";

const FOCUS_HIGHLIGHT = "pdf-flag-focus";
const FLAGGED_HIGHLIGHT = "pdf-flagged";
const FOCUS_MS = 3500;

const hasHighlightApi = () =>
  typeof Highlight !== "undefined" && typeof CSS !== "undefined" && !!CSS.highlights;

/** Text nodes of one page's text layer, in reading order. */
function textNodes(layer: HTMLElement): Text[] {
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) nodes.push(node as Text);
  return nodes;
}

/** A DOM Range over `quote` within one page's layer, or null. */
function quoteRange(layer: HTMLElement, quote: string): Range | null {
  const nodes = textNodes(layer);
  const loc = locateQuote(
    nodes.map((n) => n.data),
    quote
  );
  if (!loc) return null;
  try {
    const range = document.createRange();
    range.setStart(nodes[loc.startChunk], loc.startOffset);
    range.setEnd(nodes[loc.endChunk], loc.endOffset);
    return range;
  } catch {
    return null;
  }
}

/** The 1-based page a DOM node sits on, from its page wrapper. */
function pageOfNode(node: Node | null): number | null {
  const el = node instanceof Element ? node : node?.parentElement;
  const wrapper = el?.closest<HTMLElement>("[data-page-number]");
  const n = wrapper ? Number(wrapper.dataset.pageNumber) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function PdfReview({
  src,
  name,
  documentId,
  initialPage,
  initialQuote = null,
  moments,
  currentUserId,
  canCreate,
  canEditAny,
  canDeleteAny,
}: {
  src: string;
  name: string;
  documentId: string;
  /** From the page's ?flag= deep link — open at this page… */
  initialPage: number | null;
  /** …and highlight this passage on it. */
  initialQuote?: string | null;
  moments: RailMoment[];
  currentUserId: string;
  canCreate: boolean;
  canEditAny: boolean;
  canDeleteAny: boolean;
}) {
  const viewerRef = useRef<PdfViewerHandle | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [composerAnchor, setComposerAnchor] = useState<ComposerAnchor | null>(null);
  const [selection, setSelection] = useState<{
    quote: string;
    page: number;
    top: number;
    left: number;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Our own fallback selection must not offer itself for flagging. */
  const suppressSelectionRef = useRef(false);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 5000);
  }, []);

  // ── Capture: selection inside a page → floating button ─────────────
  const readSelection = useCallback(() => {
    if (suppressSelectionRef.current) return;
    const root = rootRef.current;
    const sel = document.getSelection();
    if (!root || !sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setSelection(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const page = pageOfNode(range.startContainer);
    if (!root.contains(range.commonAncestorContainer) || page === null) {
      setSelection(null);
      return;
    }
    const quote = sel.toString().replace(/\s+/g, " ").trim().slice(0, MAX_QUOTE_CHARS);
    if (quote === "") {
      setSelection(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    const wrap = root.getBoundingClientRect();
    setSelection({
      quote,
      page,
      top: rect.bottom - wrap.top + 6,
      left: Math.max(0, Math.min(rect.left - wrap.left, wrap.width - 140)),
    });
  }, []);

  useEffect(() => {
    if (!canCreate) return;
    document.addEventListener("selectionchange", readSelection);
    // The pages scroll inside the viewer — keep the button with the text.
    const root = rootRef.current;
    root?.addEventListener("scroll", readSelection, { capture: true, passive: true });
    return () => {
      document.removeEventListener("selectionchange", readSelection);
      root?.removeEventListener("scroll", readSelection, { capture: true });
    };
  }, [canCreate, readSelection]);

  const flagSelection = async () => {
    if (!selection) return;
    const { quote, page } = selection;
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    let hint: string | undefined;
    const layer = await viewerRef.current?.pageTextLayer(page);
    if (layer) {
      const chunks = textNodes(layer).map((n) => n.data);
      if (locateQuote(chunks, quote) === null) {
        hint =
          "Heads up: this selection can't be found again on the page (it may run onto the next page), so the flag will jump to the page but may not highlight it. Try selecting within one page.";
      } else {
        const count = countQuoteOccurrences(chunks, quote);
        if (count > 1) {
          hint = `Heads up: this text appears ${count} times on page ${page} — clicking the flag will highlight the first one. Select a longer passage to avoid that.`;
        }
      }
    }
    setComposerAnchor({ kind: "page", pageNumber: page, quote, hint });
  };

  // ── Navigate: page (+ passage) → scroll + highlight ────────────────
  const focusPassage = useCallback(
    async (page: number, quote: string) => {
      const viewer = viewerRef.current;
      if (!viewer) return;
      const layer = await viewer.pageTextLayer(page);
      const range = layer ? quoteRange(layer, quote) : null;
      if (!range) {
        viewer.goToPage(page);
        showNotice(
          `Passage not found on page ${page} — it's shown at the page instead. The flagged text may span pages or not be selectable text (e.g. a scan).`
        );
        return;
      }
      (range.startContainer.parentElement ?? layer)?.scrollIntoView({ block: "center" });
      if (focusTimer.current) clearTimeout(focusTimer.current);
      if (hasHighlightApi()) {
        CSS.highlights.set(FOCUS_HIGHLIGHT, new Highlight(range));
        focusTimer.current = setTimeout(() => CSS.highlights.delete(FOCUS_HIGHLIGHT), FOCUS_MS);
      } else {
        suppressSelectionRef.current = true;
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        focusTimer.current = setTimeout(() => {
          suppressSelectionRef.current = false;
        }, 400);
      }
    },
    [showNotice]
  );

  const navigate = (m: RailMoment) => {
    if (m.pageNumber === null) return;
    if (m.quote) void focusPassage(m.pageNumber, m.quote);
    else viewerRef.current?.goToPage(m.pageNumber);
  };

  // ?flag= deep link, once the document has laid out.
  const onReady = useCallback(() => {
    if (initialPage === null) return;
    if (initialQuote) void focusPassage(initialPage, initialQuote);
    else viewerRef.current?.goToPage(initialPage);
  }, [initialPage, initialQuote, focusPassage]);

  // ── Persistent marks on every flagged passage ──────────────────────
  const layersRef = useRef(new Map<number, HTMLElement>());
  const momentsRef = useRef(moments);
  const paintFlagged = useCallback(() => {
    if (!hasHighlightApi()) return;
    const ranges: Range[] = [];
    for (const m of momentsRef.current) {
      if (m.pageNumber === null || !m.quote) continue;
      const layer = layersRef.current.get(m.pageNumber);
      const r = layer ? quoteRange(layer, m.quote) : null;
      if (r) ranges.push(r);
    }
    if (ranges.length) CSS.highlights.set(FLAGGED_HIGHLIGHT, new Highlight(...ranges));
    else CSS.highlights.delete(FLAGGED_HIGHLIGHT);
  }, []);
  useEffect(() => {
    momentsRef.current = moments;
    paintFlagged();
  }, [moments, paintFlagged]);
  const onTextLayerChange = useCallback(
    (page: number, layer: HTMLElement | null) => {
      if (layer) layersRef.current.set(page, layer);
      else layersRef.current.delete(page);
      paintFlagged();
    },
    [paintFlagged]
  );

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      if (focusTimer.current) clearTimeout(focusTimer.current);
      if (hasHighlightApi()) {
        CSS.highlights.delete(FOCUS_HIGHLIGHT);
        CSS.highlights.delete(FLAGGED_HIGHLIGHT);
      }
    },
    []
  );

  return (
    <ReviewPanel
      documentId={documentId}
      moments={moments}
      currentUserId={currentUserId}
      canCreate={canCreate}
      canEditAny={canEditAny}
      canDeleteAny={canDeleteAny}
      captureLabel="Flag this page"
      captureAnchor={() => ({
        kind: "page",
        pageNumber: viewerRef.current?.currentPage() ?? null,
      })}
      composerAnchor={composerAnchor}
      onComposerAnchorChange={setComposerAnchor}
      onNavigate={navigate}
      emptyHint="Select text on a page and hit “Flag selection”, or flag the page you're on."
    >
      {notice && (
        <div
          role="status"
          className="flex items-center gap-1.5 rounded-md border border-warn-border bg-warn-soft px-3 py-2 text-xs text-warn"
        >
          <SearchX className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {notice}
        </div>
      )}
      <div ref={rootRef} className="relative flex min-h-0 flex-1 flex-col">
        <PdfDocumentViewer
          ref={viewerRef}
          src={src}
          name={name}
          onReady={onReady}
          onTextLayerChange={onTextLayerChange}
        />
        {selection && (
          <button
            type="button"
            // Keep the selection alive through the click.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void flagSelection()}
            style={{ top: selection.top, left: selection.left }}
            className="absolute z-10 inline-flex h-7 items-center gap-1.5 rounded-md border border-brand-300 bg-white px-2.5 text-xs font-medium text-brand-700 shadow-sm transition-colors hover:bg-brand-soft"
          >
            <Flag className="h-3.5 w-3.5" aria-hidden />
            Flag selection
          </button>
        )}
      </div>
    </ReviewPanel>
  );
}
