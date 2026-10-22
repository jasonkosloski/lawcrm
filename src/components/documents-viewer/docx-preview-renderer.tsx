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
 * Security: the file is attacker-controlled. The render is built
 * DETACHED (parseAsync + renderDocument, not renderAsync) and goes
 * through `sanitizeRenderedDocx` BEFORE it is attached to the page,
 * so a hostile <style> breakout or url() never reaches the live
 * document where the browser could fetch it (dangerous hrefs,
 * remote fetches, active elements — see that module's header). `renderAltChunks: false` is load-bearing: it is
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
 *
 * Fit to width: pages keep their real dimensions (8.5in ≈ 816px), so
 * on a phone or a narrow pane they'd overflow the scroll shell. Each
 * page section gets CSS `zoom` (layout-affecting, unlike transform,
 * so scroll extents and text selection stay true) to shrink it to the
 * available width — never enlarged past 100%. The zoom is applied
 * only AFTER docx-preview's deferred tab-stop pass, because that pass
 * measures getBoundingClientRect deltas and converts them to points
 * assuming an unscaled page; the skeleton stays up until then so the
 * reader never sees the page jump from full size to fitted.
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
  // docx-preview centers pages with `align-items: center`, which
  // pushes a page wider than the shell past its LEFT edge where it
  // can't be scrolled to. Safe-center falls back to start alignment
  // on overflow (e.g. a landscape section on a phone at the zoom floor).
  "[&_.docx-wrapper]:items-center-safe",
  // Fit-to-width — see the component header.
  "[&_section.docx]:[zoom:var(--docx-fit,1)]",
].join(" ");

/** docx-preview runs its tab-stop pass in a 500ms timeout scheduled
 *  during renderDocument. Timers with an equal-or-shorter delay fire
 *  in registration order, so waiting at least as long after render
 *  guarantees the pass has run before pages are zoomed. */
const TAB_STOP_SETTLE_MS = 550;

/** Smallest fit zoom — below this text is unreadable and the reader
 *  is better off panning a safe-centered page. */
const MIN_FIT_ZOOM = 0.3;

/** Zoom that fits a page of `pageWidth` px into `availableWidth` px.
 *  Shrinks only; 1 when either width is unmeasured. */
export function docxFitZoom(availableWidth: number, pageWidth: number): number {
  if (availableWidth <= 0 || pageWidth <= 0) return 1;
  return Math.min(1, Math.max(MIN_FIT_ZOOM, availableWidth / pageWidth));
}

/** Client-side preview ceiling — mirrors `DOCX_MAX_BYTES` in
 *  `src/lib/document-preview.ts` (25 MB; that module imports mammoth
 *  and the storage adapter, so it can't be pulled into a client
 *  bundle for one number). */
const DOCX_CLIENT_MAX_BYTES = 25 * 1024 * 1024;

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
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  /** Widest page's natural (unzoomed) width, measured once after the
   *  tab-stop pass; 0 until then. */
  const [pageWidth, setPageWidth] = useState(0);
  const [fitZoom, setFitZoom] = useState(1);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(src, { signal: controller.signal });
        if (!res.ok) throw new Error(`download responded ${res.status}`);
        // Same ceiling the server's mammoth pipeline enforces. A file
        // over it is declined BEFORE the body is buffered when the
        // response declares its length, and again after for chunked
        // responses; the fallback node (the server's "too large —
        // download it" card) takes over instead of freezing the tab
        // in parseAsync.
        const declared = Number(res.headers?.get("content-length"));
        if (Number.isFinite(declared) && declared > DOCX_CLIENT_MAX_BYTES) {
          throw new Error(`docx is ${declared} bytes — over the preview cap`);
        }
        const bytes = await res.arrayBuffer();
        if (bytes.byteLength > DOCX_CLIENT_MAX_BYTES) {
          throw new Error(`docx is ${bytes.byteLength} bytes — over the preview cap`);
        }
        // Dynamic import: docx-preview is a browser-only, docx-page-
        // only dependency — keep it out of the shared client bundle.
        const { parseAsync, renderDocument } = await import("docx-preview");
        const container = pagesRef.current;
        if (cancelled || !container) return;
        // SECURITY — build the render DETACHED, sanitize it, and only
        // then attach. `renderAsync` would append docx-preview's
        // <style> text (built from unescaped document strings, so a
        // `}body::after{content:url(http://attacker/x)}` breakout is
        // possible) and inline style/src attributes into the live
        // page BEFORE we could sanitize them, giving the browser a
        // window to start the fetch. `renderDocument` returns the
        // nodes unattached (renderAsync is just parse + render +
        // append), so nothing applies or loads until it is clean.
        // Tab-stop measurement is scheduled by the library 500ms after
        // render and reads the live DOM, so it sees the attached nodes.
        const doc = await parseAsync(bytes, RENDER_OPTIONS);
        const nodes = await renderDocument(doc, RENDER_OPTIONS);
        if (cancelled) return;
        const staging = document.createElement("div");
        for (const node of nodes) staging.appendChild(node);
        sanitizeRenderedDocx(staging);
        container.replaceChildren(...Array.from(staging.childNodes));
        await new Promise((resolve) => setTimeout(resolve, TAB_STOP_SETTLE_MS));
        if (cancelled) return;
        const sections = container.querySelectorAll<HTMLElement>("section.docx");
        setPageWidth(Math.max(0, ...Array.from(sections, (section) => section.offsetWidth)));
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
          error,
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

  // Track the shell width so the fit follows rotation and pane resizes.
  // The wrapper's padding sits outside the zoomed sections, so it is
  // subtracted at its real size.
  useEffect(() => {
    const shell = shellRef.current;
    if (phase !== "rendered" || !shell || pageWidth <= 0) return;
    const update = () => {
      const wrapper = shell.querySelector<HTMLElement>(".docx-wrapper");
      const style = wrapper ? getComputedStyle(wrapper) : null;
      const padding = style ? parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) : 0;
      setFitZoom(docxFitZoom(shell.clientWidth - padding, pageWidth));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(shell);
    return () => ro.disconnect();
  }, [phase, pageWidth]);

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
          ref={shellRef}
          className={`scrollbar-thin relative min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-paper-2 ${WRAPPER_RESTYLE} ${
            // Below lg the shell sizes to its content (see
            // DocumentViewerBody), and the render target is empty
            // while loading — hold room for the skeleton overlay.
            phase === "loading" ? "min-h-[420px]" : ""
          }`}
          style={{ "--docx-fit": fitZoom } as React.CSSProperties}
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
