/**
 * TextReview — the ReviewPanel adapter for rendered-text documents
 * (docx sheet, text <pre>, CSV table).
 *
 * Capture: selecting text inside the rendered container raises a
 * floating "Flag selection" affordance (document `selectionchange`
 * + `getSelection()`; the trimmed selection becomes the quote
 * anchor, capped at MAX_QUOTE_CHARS). The button preventDefaults
 * mousedown so clicking it doesn't collapse the selection first.
 * There's also a standing "Flag document" capture button (via
 * ReviewPanel) for anchorless whole-document flags.
 *
 * Navigate: clicking a quote-anchored flag walks the container's
 * text nodes, relocates the first case-insensitive match
 * (`locateQuote` — pure, tested), scrolls it into view, and
 * highlights it for a few seconds — CSS Custom Highlight API where
 * available, programmatic selection as the fallback (guarded so our
 * own selection doesn't re-raise the capture affordance). When the
 * quote no longer matches — the doc re-rendered differently or the
 * text changed — a visible "quote not found in the current render"
 * notice appears instead of failing silently.
 *
 * Selection.toString() inserts separators between blocks that no
 * text node contains, so quotes captured across paragraph/cell
 * boundaries may save fine but fail to relocate — that lands on the
 * same not-found notice (see quote-locate.ts).
 *
 * Async bodies: the docx-preview renderer fetches + renders AFTER
 * mount, so its text isn't walkable at hydration. With
 * `awaitContentReady` the ?flag= deep-link relocation waits for the
 * body's bubbling VIEWER_CONTENT_READY_EVENT (fired on both the
 * successful render and the fallback swap) instead of running
 * against an empty container and showing a spurious not-found
 * notice. Server-rendered bodies (mammoth sheet, text, CSV) omit
 * the prop and keep the immediate rAF behavior.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Flag, SearchX } from "lucide-react";
import { MAX_QUOTE_CHARS } from "@/lib/flag-anchor";
import { locateQuote } from "@/lib/quote-locate";
import { VIEWER_CONTENT_READY_EVENT } from "@/components/documents-viewer/content-ready-event";
import { ReviewPanel } from "./review-panel";
import type { ComposerAnchor } from "./flag-composer";
import type { RailMoment } from "./moments-rail";

const HIGHLIGHT_NAME = "evidence-quote";
const HIGHLIGHT_MS = 2500;

export function TextReview({
  documentId,
  initialQuote,
  awaitContentReady = false,
  moments,
  currentUserId,
  canCreate,
  canEditAny,
  canDeleteAny,
  children,
}: {
  documentId: string;
  /** From the page's ?flag= deep link — highlight this quote on load. */
  initialQuote: string | null;
  /** Set when the body renders its text asynchronously (docx-preview)
   *  — defers the initialQuote relocation until the body dispatches
   *  VIEWER_CONTENT_READY_EVENT. */
  awaitContentReady?: boolean;
  moments: RailMoment[];
  currentUserId: string;
  canCreate: boolean;
  canEditAny: boolean;
  canDeleteAny: boolean;
  /** The server-rendered viewer body (DocxViewer / TextPreview /
   *  CsvTablePreview). */
  children: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [composerAnchor, setComposerAnchor] = useState<ComposerAnchor | null>(
    null
  );
  /** Live selection inside the container → floating button. */
  const [selection, setSelection] = useState<{
    quote: string;
    top: number;
    left: number;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Our fallback highlight selects programmatically — don't let
   *  that re-raise the capture affordance. */
  const suppressSelectionRef = useRef(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Capture: selection → floating "Flag selection" button ─────────
  useEffect(() => {
    if (!canCreate) return;
    const onSelectionChange = () => {
      if (suppressSelectionRef.current) return;
      const container = containerRef.current;
      const sel = document.getSelection();
      if (!container || !sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setSelection(null);
        return;
      }
      const range = sel.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) {
        setSelection(null);
        return;
      }
      const quote = sel.toString().trim().slice(0, MAX_QUOTE_CHARS);
      if (quote === "") {
        setSelection(null);
        return;
      }
      // Position the affordance just below the selection. Absolute
      // within the relative wrapper, viewport-rect math; it doesn't
      // track scroll until the next selection change — fine for a
      // transient affordance.
      const rect = range.getBoundingClientRect();
      const wrap = container.getBoundingClientRect();
      setSelection({
        quote,
        top: rect.bottom - wrap.top + 6,
        left: Math.max(0, Math.min(rect.left - wrap.left, wrap.width - 140)),
      });
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", onSelectionChange);
  }, [canCreate]);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 5000);
  }, []);

  // ── Navigate: quote → scroll + temporary highlight ─────────────────
  const navigateToQuote = useCallback(
    (quote: string) => {
      const container = containerRef.current;
      if (!container) return;
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      let node: Node | null;
      while ((node = walker.nextNode())) nodes.push(node as Text);

      const loc = locateQuote(
        nodes.map((n) => n.data),
        quote
      );
      if (!loc) {
        showNotice(
          "Quote not found in the current render — the document text may have changed since it was flagged."
        );
        return;
      }

      const range = document.createRange();
      range.setStart(nodes[loc.startChunk], loc.startOffset);
      range.setEnd(nodes[loc.endChunk], loc.endOffset);
      nodes[loc.startChunk].parentElement?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });

      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      if (typeof Highlight !== "undefined" && CSS.highlights) {
        // CSS Custom Highlight API — paints the range without
        // touching the DOM (styled via the ::highlight rule below).
        CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(range));
        highlightTimer.current = setTimeout(
          () => CSS.highlights.delete(HIGHLIGHT_NAME),
          HIGHLIGHT_MS
        );
      } else {
        // Fallback: select the match — native, visible everywhere,
        // no DOM mutation. Guard the selectionchange listener so we
        // don't offer to flag our own highlight.
        suppressSelectionRef.current = true;
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        highlightTimer.current = setTimeout(() => {
          suppressSelectionRef.current = false;
        }, 400);
      }
    },
    [showNotice]
  );

  // ?flag= deep link — relocate + highlight on mount (the body is
  // server-rendered, so the text is already in the DOM; the rAF
  // waits out hydration paint). Async bodies (awaitContentReady)
  // announce themselves instead — wait for their bubbling ready
  // event so we don't walk an empty container. Deps are stable, so
  // this runs once.
  useEffect(() => {
    if (!initialQuote) return;
    if (awaitContentReady) {
      const container = containerRef.current;
      if (!container) return;
      let raf = 0;
      const onReady = () => {
        // rAF waits out the commit that revealed the content.
        raf = requestAnimationFrame(() => navigateToQuote(initialQuote));
      };
      container.addEventListener(VIEWER_CONTENT_READY_EVENT, onReady, {
        once: true,
      });
      return () => {
        container.removeEventListener(VIEWER_CONTENT_READY_EVENT, onReady);
        cancelAnimationFrame(raf);
      };
    }
    const raf = requestAnimationFrame(() => navigateToQuote(initialQuote));
    return () => cancelAnimationFrame(raf);
  }, [initialQuote, awaitContentReady, navigateToQuote]);

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    },
    []
  );

  const navigate = (m: RailMoment) => {
    if (m.quote) navigateToQuote(m.quote);
  };

  const flagSelection = () => {
    if (!selection) return;
    setComposerAnchor({ kind: "quote", quote: selection.quote });
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <ReviewPanel
      documentId={documentId}
      moments={moments}
      currentUserId={currentUserId}
      canCreate={canCreate}
      canEditAny={canEditAny}
      canDeleteAny={canDeleteAny}
      captureLabel="Flag document"
      captureAnchor={() => ({ kind: "document" })}
      composerAnchor={composerAnchor}
      onComposerAnchorChange={setComposerAnchor}
      onNavigate={navigate}
      emptyHint="Select a passage and hit “Flag selection” — or flag the whole document."
    >
      {/* ::highlight() can't be expressed in Tailwind utilities —
          the rule rides with the component that owns the name. */}
      <style>{`::highlight(${HIGHLIGHT_NAME}) { background-color: rgba(250, 204, 21, 0.5); }`}</style>

      {notice && (
        <div className="flex items-center gap-1.5 rounded-md border border-warn-border bg-warn-soft px-3 py-2 text-xs text-warn">
          <SearchX className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {notice}
        </div>
      )}

      <div ref={containerRef} className="relative flex min-h-0 flex-1 flex-col">
        {children}

        {selection && (
          <button
            type="button"
            // Keep the selection alive through the click — mousedown
            // would otherwise collapse it before onClick reads it.
            onMouseDown={(e) => e.preventDefault()}
            onClick={flagSelection}
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
