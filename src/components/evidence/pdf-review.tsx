/**
 * PdfReview — the ReviewPanel adapter for PDFs, on the built-in
 * pdf.js viewer (PdfDocumentViewer).
 *
 * Capture, two ways:
 *   - Select text → a floating "Flag selection" button → a PAGE + QUOTE
 *     flag: the page the selection starts on, the last page it reaches
 *     when it runs across a page break (`endPageNumber`, up to
 *     MAX_PDF_PAGE_SPAN pages), and the selected text. The pages
 *     disambiguate a phrase that appears elsewhere; the composer warns
 *     when the passage repeats within them, or can't be found again.
 *   - "Flag this page" → a page-only flag, prefilled with the page
 *     under the reading line (blank the page = whole document).
 *
 * Navigate: a flag with a quote scrolls to its page, relocates the
 * passage across its pages' text layers (the viewer keeps the whole
 * span rendered) (`locateQuote` — the same
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
import { MAX_PDF_PAGE_SPAN, MAX_QUOTE_CHARS } from "@/lib/flag-anchor";
import { countQuoteOccurrences, locateQuote } from "@/lib/quote-locate";
import { ReviewPanel } from "./review-panel";
import type { ComposerAnchor } from "./flag-composer";
import type { RailMoment } from "./moments-rail";
import { Button } from "@/components/ui/button";

const FOCUS_HIGHLIGHT = "pdf-flag-focus";
const FLAGGED_HIGHLIGHT = "pdf-flagged";
const FOCUS_MS = 3500;

const hasHighlightApi = () =>
  typeof Highlight !== "undefined" && typeof CSS !== "undefined" && !!CSS.highlights;

/** Text nodes of the given pages' text layers, in reading order
 *  (one layer, or a span's layers first page to last). */
function textNodes(layers: HTMLElement | HTMLElement[]): Text[] {
  const nodes: Text[] = [];
  for (const layer of Array.isArray(layers) ? layers : [layers]) {
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) nodes.push(node as Text);
  }
  return nodes;
}

/** A DOM Range over `quote` within the layers, or null. A range may
 *  start on one page and end on the next. */
function quoteRange(layers: HTMLElement | HTMLElement[], quote: string): Range | null {
  const nodes = textNodes(layers);
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

/** First..last page a selection touches. The ends usually sit inside
 *  a page; when one lands in the gap between pages, fall back to the
 *  page wrappers the range crosses. */
function selectionPages(root: HTMLElement, range: Range): { first: number; last: number } | null {
  let first = pageOfNode(range.startContainer);
  let last = pageOfNode(range.endContainer);
  if (first === null || last === null) {
    const crossed = [...root.querySelectorAll<HTMLElement>("[data-page-number]")]
      .filter((el) => range.intersectsNode(el))
      .map((el) => Number(el.dataset.pageNumber));
    if (crossed.length === 0) return null;
    first ??= Math.min(...crossed);
    last ??= Math.max(...crossed);
  }
  return first <= last ? { first, last } : { first: last, last: first };
}

/** All non-null, or null — a span's passage needs every page's text. */
function allLayers(layers: (HTMLElement | null)[]): HTMLElement[] | null {
  return layers.every((l): l is HTMLElement => l !== null) ? layers : null;
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
  initialEndPage = null,
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
  /** …and highlight this passage on it… */
  initialQuote?: string | null;
  /** …which may run on to this page. */
  initialEndPage?: number | null;
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
    /** Last page the selection reaches (== page when it doesn't cross). */
    endPage: number;
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
    const pages = root.contains(range.commonAncestorContainer) ? selectionPages(root, range) : null;
    if (pages === null) {
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
      page: pages.first,
      endPage: pages.last,
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
    let endPage = selection.endPage;
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    let hint: string | undefined;
    if (endPage - page + 1 > MAX_PDF_PAGE_SPAN) {
      endPage = page + MAX_PDF_PAGE_SPAN - 1;
      hint = `Heads up: a flag can span at most ${MAX_PDF_PAGE_SPAN} pages, so this one stops at page ${endPage}.`;
    }
    const where = endPage > page ? `pages ${page}–${endPage}` : `page ${page}`;
    const layers = allLayers((await viewerRef.current?.pageTextLayers(page, endPage)) ?? []);
    if (layers && !hint) {
      const chunks = textNodes(layers).map((n) => n.data);
      if (locateQuote(chunks, quote) === null) {
        hint =
          "Heads up: this selection can't be found again in the text, so the flag will jump to the page but may not highlight it.";
      } else {
        const count = countQuoteOccurrences(chunks, quote);
        if (count > 1) {
          hint = `Heads up: this text appears ${count} times on ${where} — clicking the flag will highlight the first one. Select a longer passage to avoid that.`;
        }
      }
    }
    setComposerAnchor({
      kind: "page",
      pageNumber: page,
      ...(endPage > page ? { endPageNumber: endPage } : {}),
      quote,
      hint,
    });
  };

  // ── Navigate: page (+ passage) → scroll + highlight ────────────────
  const focusPassage = useCallback(
    async (page: number, endPage: number | null, quote: string) => {
      const viewer = viewerRef.current;
      if (!viewer) return;
      const last = endPage !== null && endPage > page ? endPage : page;
      const layers = allLayers(await viewer.pageTextLayers(page, last));
      const range = layers ? quoteRange(layers, quote) : null;
      if (!range) {
        viewer.goToPage(page);
        const where = last > page ? `pages ${page}–${last}` : `page ${page}`;
        showNotice(
          `Passage not found on ${where} — it's shown at the page instead. The flagged text may not be selectable text (e.g. a scan).`
        );
        return;
      }
      range.startContainer.parentElement?.scrollIntoView({ block: "center" });
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
    if (m.quote) void focusPassage(m.pageNumber, m.endPageNumber, m.quote);
    else viewerRef.current?.goToPage(m.pageNumber);
  };

  // ?flag= deep link, once the document has laid out.
  const onReady = useCallback(() => {
    if (initialPage === null) return;
    if (initialQuote) void focusPassage(initialPage, initialEndPage, initialQuote);
    else viewerRef.current?.goToPage(initialPage);
  }, [initialPage, initialEndPage, initialQuote, focusPassage]);

  // ── Persistent marks on every flagged passage ──────────────────────
  const layersRef = useRef(new Map<number, HTMLElement>());
  const momentsRef = useRef(moments);
  const paintFlagged = useCallback(() => {
    if (!hasHighlightApi()) return;
    const ranges: Range[] = [];
    for (const m of momentsRef.current) {
      if (m.pageNumber === null || !m.quote) continue;
      // Every page of the flag's span must be rendered to find it.
      const last = m.endPageNumber != null && m.endPageNumber > m.pageNumber ? m.endPageNumber : m.pageNumber;
      const layers = allLayers(
        Array.from({ length: last - m.pageNumber + 1 }, (_, i) => layersRef.current.get(m.pageNumber! + i) ?? null)
      );
      const r = layers ? quoteRange(layers, m.quote) : null;
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
          <Button
            variant="outline"
            size="xs"
            type="button"
            // Keep the selection alive through the click.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void flagSelection()}
            style={{ top: selection.top, left: selection.left }}
            className="absolute z-10 border-brand-300 text-brand-700 shadow-sm hover:bg-brand-soft"
          >
            <Flag className="h-3.5 w-3.5" aria-hidden />
            Flag selection
          </Button>
        )}
      </div>
    </ReviewPanel>
  );
}
