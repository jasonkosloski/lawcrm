/**
 * Word (.docx) preview — layout-faithful client-side render via
 * docx-preview, with the server-side mammoth pipeline as fallback.
 *
 * Why two renderers: mammoth is a semantic converter — it discards
 * layout by design, so tab stops (signature lines), table cell
 * vertical alignment (pleading captions), page dimensions, and
 * headers/footers never survive it. docx-preview reconstructs those:
 * it computes tab stops (`experimental: true` — that option IS the
 * tab-stop engine), honors cell alignment/widths, and renders real
 * page-shaped sections. When docx-preview can't fetch or parse the
 * file, the component swaps in the `fallback` node — the page
 * precomputes the mammoth render (or its failure card) server-side
 * and passes it down, so the swap is instant and needs no extra
 * round trip. Honest cost: the mammoth conversion runs on every docx
 * view and its HTML rides the RSC payload even when unused. That is
 * exactly what shipped before this component existed (no regression),
 * and converting lazily would need a new API route; revisit if docx
 * traffic ever makes the double render measurable.
 *
 * Security: the file is attacker-controlled. The rendered container
 * goes through `sanitizeRenderedDocx` before being revealed
 * (dangerous hrefs, remote fetches, active elements — see that
 * module's header). `renderAltChunks: false` is load-bearing: it is
 * the one docx-preview feature that injects raw embedded HTML
 * (iframe srcdoc). The fallback path needs none of this — mammoth
 * output is already server-sanitized.
 *
 * Evidence review compatibility: docx-preview builds real text
 * nodes, so TextReview's selection capture and TreeWalker quote
 * relocation work unchanged on the render. Because the text arrives
 * AFTER mount, the component announces readiness (both outcomes) via
 * `dispatchViewerContentReady`; TextReview's `awaitContentReady`
 * defers the ?flag= deep-link relocation until then.
 *
 * The loading skeleton overlays (not replaces) the render target —
 * docx-preview's tab-stop math measures the live DOM, so the
 * container must stay laid out (never display:none) while
 * `renderAsync` runs.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { dispatchViewerContentReady } from "./content-ready-event";
import { sanitizeRenderedDocx } from "./sanitize-rendered-docx";

/** docx-preview options — see the component header for the
 *  load-bearing ones. Width/height are NOT ignored so sections keep
 *  their real page dimensions (the scroll shell handles overflow on
 *  narrow screens). `ignoreLastRenderedPageBreak: false` lets
 *  Word-saved documents paginate where Word paginated them. */
const RENDER_OPTIONS = {
  inWrapper: true,
  ignoreWidth: false,
  ignoreHeight: false,
  breakPages: true,
  ignoreLastRenderedPageBreak: false,
  experimental: true, // tab-stop computation
  renderHeaders: true,
  renderFooters: true,
  renderFootnotes: true,
  renderEndnotes: true,
  // SECURITY — altChunks are raw HTML fragments embedded in the docx,
  // rendered as <iframe srcdoc>. Never enable for untrusted files.
  renderAltChunks: false,
  // data: URLs instead of URL.createObjectURL for images/fonts — no
  // object-URL lifecycle to leak across re-renders and unmounts.
  useBase64URL: true,
} as const;

/** Restyle docx-preview's built-in chrome to match the viewer: its
 *  `.docx-wrapper` default is an opaque dark-gray band — flatten it
 *  to transparent padding so our bg-paper-2 scroll shell (same
 *  backdrop as the PDF viewer) shows through; the white page
 *  sections and their shadows stay. */
const WRAPPER_RESTYLE = [
  // Descendant-selector utilities out-specificity docx-preview's own
  // single-class stylesheet rules, so no `!important` needed — this
  // also overrides its `padding-bottom: 0`.
  "[&_.docx-wrapper]:bg-transparent",
  "[&_.docx-wrapper]:p-4",
  "sm:[&_.docx-wrapper]:p-8",
].join(" ");

type Phase = "loading" | "rendered" | "fallback";

export function DocxPreviewRenderer({
  src,
  name,
  fallback,
}: {
  /** Same-origin download URL for the .docx bytes. Under the blob
   *  storage driver the route 302s to the CDN — fetch follows
   *  redirects, so no special handling. */
  src: string;
  name: string;
  /** Server-rendered mammoth body (sanitized sheet, or its failure
   *  card) — mounted ONLY when docx-preview fails, so the TreeWalker
   *  in TextReview never sees two copies of the document text. */
  fallback: React.ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  /** renderAsync target — must exist and stay laid out from mount. */
  const pagesRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(src, { signal: controller.signal });
        if (!res.ok) throw new Error(`download responded ${res.status}`);
        const bytes = await res.arrayBuffer();
        // Dynamic import: docx-preview is a browser-only, docx-page-
        // only dependency — keep it out of the shared client bundle.
        const { renderAsync } = await import("docx-preview");
        const container = pagesRef.current;
        if (cancelled || !container) return;
        await renderAsync(bytes, container, undefined, RENDER_OPTIONS);
        if (cancelled) return;
        sanitizeRenderedDocx(container);
        setPhase("rendered");
      } catch (error) {
        if (cancelled) return;
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        // Not an app error — corrupt files and mislabeled legacy
        // .doc land here by design. Log for diagnosis, fall back.
        console.warn(
          `docx-preview could not render "${name}" — using the mammoth fallback.`,
          error
        );
        // Clear any partial render so the fallback isn't preceded by
        // half a document (and TextReview can't walk stale text).
        pagesRef.current?.replaceChildren();
        setPhase("fallback");
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [src, name]);

  // Tell quote-relocation listeners the walkable text has settled —
  // fired once per outcome transition, after the commit that mounted
  // the final content (render or fallback).
  useEffect(() => {
    if (phase === "loading") return;
    if (rootRef.current) dispatchViewerContentReady(rootRef.current);
  }, [phase]);

  return (
    <div ref={rootRef} className="relative flex min-h-0 flex-1 flex-col">
      {phase === "fallback" ? (
        fallback
      ) : (
        <div
          className={`scrollbar-thin relative min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-paper-2 ${WRAPPER_RESTYLE}`}
        >
          {/* Render target — kept mounted and measurable during
              renderAsync (tab-stop math needs live layout). */}
          <div ref={pagesRef} aria-busy={phase === "loading"} />
          {phase === "loading" && (
            <div
              className="absolute inset-0 z-10 flex items-start justify-center bg-paper-2 p-4 sm:p-8"
              role="status"
              aria-label={`Loading preview of ${name}`}
            >
              {/* Page-shaped skeleton while bytes download + render. */}
              <div className="flex w-full max-w-2xl flex-col gap-3 rounded-sm border border-line bg-white px-8 py-10 shadow-sm sm:px-14 sm:py-14">
                <div className="h-4 w-2/5 animate-pulse rounded bg-paper-2" />
                <div className="h-3 w-full animate-pulse rounded bg-paper-2" />
                <div className="h-3 w-full animate-pulse rounded bg-paper-2" />
                <div className="h-3 w-4/5 animate-pulse rounded bg-paper-2" />
                <div className="mt-4 h-3 w-full animate-pulse rounded bg-paper-2" />
                <div className="h-3 w-3/5 animate-pulse rounded bg-paper-2" />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
