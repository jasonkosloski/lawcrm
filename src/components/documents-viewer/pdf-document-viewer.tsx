/**
 * Built-in PDF viewer — renders the PDF in the page with pdf.js
 * instead of handing it to the browser's PDF plugin in an iframe.
 *
 * Why: the plugin is a black box. We can't read its current page,
 * can't jump without reloading it, and can't see the text the
 * reviewer selected, so flags could only carry a hand-typed page
 * number. Rendering ourselves gives every page a canvas plus pdf.js's
 * transparent TEXT LAYER, so a selection becomes a page + quote flag
 * and a flag can scroll to its passage and highlight it.
 *
 * Shape:
 *   - The document loads once (pdf.js streams and range-loads from
 *     the auth-gated download route; a blob-storage 302 is followed).
 *   - Every page gets a placeholder at its size, so the scrollbar is
 *     true and jumps are pure arithmetic (`pageTops`). Only pages
 *     within a margin of the viewport render their canvas + text
 *     layer; pages that scroll away are cleared, so a 5,000-page
 *     production doesn't hold 5,000 canvases.
 *   - Zoom is a multiplier on fit-to-width and keeps the reader's
 *     place across zoom changes.
 *   - The parent drives it through `ref` (PdfViewerHandle): go to a
 *     page, await a page's text layer (for highlighting), read the
 *     current page. `onTextLayerChange` reports layers as they mount
 *     and unmount.
 *
 * Hardening: pdf.js 6 never evals font code; no annotation, form or
 * XFA layer is mounted, so embedded links and scripts are inert.
 * Password-protected or unreadable files show a download fallback.
 */

"use client";

import "./pdf-text-layer.css";
import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronDown, ChevronUp, Download, ExternalLink, Minus, Plus } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  canvasOutputScale,
  fitWidthScale,
  pageAtOffset,
  parsePageJump,
  stepZoom,
} from "@/lib/pdf-viewer-math";

type PdfJs = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfJs> | null = null;

/** The previous document's teardown. Every document shares one pdf.js
 *  worker (GlobalWorkerOptions.workerPort), and pdf.js refuses to start
 *  a load while that worker is still being torn down ("PDFWorker.create
 *  - the worker is being destroyed"). Switching straight from one PDF to
 *  another hit exactly that, so each load waits for the last destroy. */
let pendingDestroy: Promise<void> = Promise.resolve();

/** pdf.js + its worker, loaded once per tab on first use (never during
 *  SSR — pdf.js needs DOM APIs). The worker is bundled by
 *  `new Worker(new URL(...))`, which Turbopack resolves. */
function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import("pdfjs-dist").then((pdfjs) => {
    if (!pdfjs.GlobalWorkerOptions.workerPort) {
      pdfjs.GlobalWorkerOptions.workerPort = new Worker(
        new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
        { type: "module" }
      );
    }
    return pdfjs;
  });
  return pdfjsPromise;
}

export type PdfViewerHandle = {
  /** Scroll so `page` (1-based) sits at the top. Out-of-range clamps. */
  goToPage(page: number): void;
  /** The page's rendered text layer, scrolling to it first if needed.
   *  null if the page doesn't exist or didn't render in time. */
  pageTextLayer(page: number): Promise<HTMLElement | null>;
  /** Text layers for pages `from`..`to` (a passage running across a
   *  page break). Keeps the whole span rendered — even pages outside
   *  the scroll window — until the next span request, and scrolls to
   *  `from`. Entries are null for pages that didn't render in time. */
  pageTextLayers(from: number, to: number): Promise<(HTMLElement | null)[]>;
  /** The page under the reading line. */
  currentPage(): number;
};

const PAGE_GAP = 12;
const PAD_TOP = 16;
/** Render pages this far above/below the viewport (px). */
const RENDER_MARGIN = 1200;
const TEXT_LAYER_WAIT_MS = 10_000;
/** The "current page" is the one under this fraction of the viewport
 *  height; zoom keeps the content under this same line in place. */
const READING_LINE = 0.3;

type Size = { w: number; h: number };

export function PdfDocumentViewer({
  src,
  name,
  ref,
  onReady,
  onTextLayerChange,
}: {
  /** Same-origin download URL for the PDF bytes. */
  src: string;
  name: string;
  ref?: React.Ref<PdfViewerHandle>;
  /** Called once the document has loaded and laid out. */
  onReady?: (numPages: number) => void;
  /** A page's text layer mounted (element) or was cleared (null). */
  onTextLayerChange?: (page: number, layer: HTMLElement | null) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [pdfjs, setPdfjs] = useState<PdfJs | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [failure, setFailure] = useState<"password" | "failed" | null>(null);
  const [baseSize, setBaseSize] = useState<Size | null>(null);
  /** Pages whose real size differs from page 1's (rare: mixed
   *  letter/legal productions, landscape exhibits). */
  const [sizeOverrides, setSizeOverrides] = useState<ReadonlyMap<number, Size>>(new Map());
  const [containerWidth, setContainerWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [range, setRange] = useState<{ first: number; last: number }>({ first: 1, last: 1 });
  /** A span the parent asked for — rendered regardless of scroll. */
  const [pinned, setPinned] = useState<{ first: number; last: number } | null>(null);
  const [current, setCurrent] = useState(1);
  const [jumpText, setJumpText] = useState<string | null>(null);

  const numPages = doc?.numPages ?? 0;

  // ── Load ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<PdfJs["getDocument"]> | null = null;
    (async () => {
      try {
        const lib = await loadPdfJs();
        await pendingDestroy;
        if (cancelled) return;
        task = lib.getDocument({ url: src });
        const loaded = await task.promise;
        const first = await loaded.getPage(1);
        const vp = first.getViewport({ scale: 1 });
        if (cancelled) return;
        setPdfjs(lib);
        setBaseSize({ w: vp.width, h: vp.height });
        setDoc(loaded);
      } catch (err) {
        if (cancelled) return;
        console.warn("PDF failed to load", err);
        setFailure((err as { name?: string })?.name === "PasswordException" ? "password" : "failed");
      }
    })();
    return () => {
      cancelled = true;
      if (task) {
        const destroying = task.destroy().catch(() => {});
        pendingDestroy = pendingDestroy.then(() => destroying);
      }
    };
  }, [src]);

  const placeRef = useRef<{ page: number; frac: number } | null>(null);
  /** Latest layout, for callbacks that outlive a render. */
  const layoutRef = useRef<{ pageTops: number[]; sizeOf: (page: number) => Size }>({
    pageTops: [],
    sizeOf: () => ({ w: 0, h: 0 }),
  });
  /** Called right before anything that changes the scale. */
  const capturePlace = useCallback(() => {
    const el = scrollRef.current;
    const { pageTops: tops, sizeOf: size } = layoutRef.current;
    if (!el || tops.length === 0) return;
    const line = el.scrollTop + el.clientHeight * READING_LINE;
    const page = pageAtOffset(tops, line);
    placeRef.current = { page, frac: (line - tops[page - 1]) / (size(page).h || 1) };
  }, []);

  // ── Width tracking (fit-to-width follows the pane) ─────────────────
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      capturePlace();
      setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc, capturePlace]);

  const scale = baseSize ? fitWidthScale(containerWidth, baseSize.w) * zoom : 1;

  const sizeOf = useCallback(
    (page: number): Size => {
      const s = sizeOverrides.get(page) ?? baseSize ?? { w: 612, h: 792 };
      return { w: Math.floor(s.w * scale), h: Math.floor(s.h * scale) };
    },
    [sizeOverrides, baseSize, scale]
  );

  /** Top offset of every page, by arithmetic — the layout below uses
   *  exactly these numbers, so jumps never measure the DOM. */
  const pageTops = useMemo(() => {
    const tops: number[] = new Array(numPages);
    let y = PAD_TOP;
    for (let i = 0; i < numPages; i++) {
      tops[i] = y;
      y += sizeOf(i + 1).h + PAGE_GAP;
    }
    return tops;
  }, [numPages, sizeOf]);

  // ── Scroll → render window + current page ──────────────────────────
  const syncFromScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || numPages === 0) return;
    const top = el.scrollTop;
    const first = pageAtOffset(pageTops, top - RENDER_MARGIN);
    const last = pageAtOffset(pageTops, top + el.clientHeight + RENDER_MARGIN);
    setRange((r) => (r.first === first && r.last === last ? r : { first, last }));
    setCurrent(pageAtOffset(pageTops, top + el.clientHeight * READING_LINE));
  }, [numPages, pageTops]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(syncFromScroll);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    syncFromScroll();
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [syncFromScroll]);

  // Keep the reader's place when the scale changes (zoom, resize):
  // remember the page + fraction under the reading line, restore
  // after layout.
  const changeZoom = (next: number) => {
    capturePlace();
    setZoom(next);
  };
  const prevTopsRef = useRef<number[]>([]);
  useEffect(() => {
    layoutRef.current = { pageTops, sizeOf };
  });
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const prev = prevTopsRef.current;
    prevTopsRef.current = pageTops;
    if (!el || prev.length === 0 || prev.length !== pageTops.length) return;
    const place = placeRef.current;
    if (place) {
      el.scrollTop =
        pageTops[place.page - 1] + place.frac * sizeOf(place.page).h - el.clientHeight * READING_LINE;
    }
  }, [pageTops, sizeOf]);
  // ── Text-layer registry (for the parent's highlight/capture) ────────
  const layersRef = useRef(new Map<number, HTMLElement>());
  const waitersRef = useRef(new Map<number, Array<(el: HTMLElement) => void>>());
  const onTextLayerChangeRef = useRef(onTextLayerChange);
  useEffect(() => {
    onTextLayerChangeRef.current = onTextLayerChange;
  });
  const handleLayer = useCallback((page: number, el: HTMLElement | null) => {
    if (el) {
      layersRef.current.set(page, el);
      const waiting = waitersRef.current.get(page);
      waitersRef.current.delete(page);
      waiting?.forEach((resolve) => resolve(el));
    } else {
      layersRef.current.delete(page);
    }
    onTextLayerChangeRef.current?.(page, el);
  }, []);

  const handlePageSize = useCallback(
    (page: number, size: Size) => {
      if (!baseSize) return;
      if (Math.abs(size.w - baseSize.w) < 0.5 && Math.abs(size.h - baseSize.h) < 0.5) return;
      setSizeOverrides((m) => {
        const prev = m.get(page);
        if (prev && prev.w === size.w && prev.h === size.h) return m;
        const next = new Map(m);
        next.set(page, size);
        return next;
      });
    },
    [baseSize]
  );

  const goToPage = useCallback(
    (page: number) => {
      const el = scrollRef.current;
      if (!el || numPages === 0) return;
      const p = Math.min(Math.max(1, Math.round(page)), numPages);
      el.scrollTop = pageTops[p - 1] - PAD_TOP / 2;
      syncFromScroll();
    },
    [numPages, pageTops, syncFromScroll]
  );

  /** Resolve with `page`'s text layer once it's rendered (or null
   *  after a timeout). Doesn't scroll. */
  const waitForLayer = useCallback((page: number): Promise<HTMLElement | null> => {
    const ready = layersRef.current.get(page);
    if (ready) return Promise.resolve(ready);
    return new Promise<HTMLElement | null>((resolve) => {
      const list = waitersRef.current.get(page) ?? [];
      let done = false;
      const finish = (el: HTMLElement | null) => {
        if (done) return;
        done = true;
        resolve(el);
      };
      list.push(finish);
      waitersRef.current.set(page, list);
      setTimeout(() => finish(null), TEXT_LAYER_WAIT_MS);
    });
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      goToPage,
      currentPage: () => current,
      pageTextLayer(page: number) {
        if (page < 1 || page > numPages) return Promise.resolve(null);
        if (!layersRef.current.has(page)) goToPage(page);
        return waitForLayer(page);
      },
      pageTextLayers(from: number, to: number) {
        const first = Math.max(1, from);
        const last = Math.min(numPages, to);
        if (last < first) return Promise.resolve([]);
        setPinned({ first, last });
        goToPage(first);
        const pages = Array.from({ length: last - first + 1 }, (_, i) => first + i);
        return Promise.all(pages.map(waitForLayer));
      },
    }),
    [goToPage, current, numPages, waitForLayer]
  );

  const readyFired = useRef(false);
  useEffect(() => {
    if (!doc || readyFired.current || containerWidth === 0) return;
    readyFired.current = true;
    // Let the first layout land before the parent jumps anywhere.
    const raf = requestAnimationFrame(() => onReady?.(doc.numPages));
    return () => cancelAnimationFrame(raf);
  }, [doc, containerWidth, onReady]);

  // ── Render ─────────────────────────────────────────────────────────
  const fallbackLinks = (
    <span>
      <a href={src} target="_blank" rel="noopener noreferrer" className="underline hover:text-brand-700">
        Open it in a new tab
      </a>{" "}
      or{" "}
      <a href={`${src}?download=1`} download={name} className="underline hover:text-brand-700">
        download it
      </a>
      .
    </span>
  );

  if (failure) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-line bg-paper-2 p-8 text-center text-xs text-ink-3">
        <div className="font-medium text-ink">
          {failure === "password"
            ? "This PDF is password-protected, so it can't be shown here."
            : "This PDF couldn't be displayed."}
        </div>
        {fallbackLinks}
      </div>
    );
  }

  const zoomPct = Math.round(scale * 100);
  const toolButton =
    "inline-flex h-7 w-7 items-center justify-center rounded-md border border-line bg-white text-ink-3 transition-colors hover:border-brand-300 hover:text-brand-700 disabled:opacity-40";

  return (
    <div className="lc-pdf flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
        <div className="flex items-center gap-1">
          <button type="button" className={toolButton} disabled={!doc || current <= 1} onClick={() => goToPage(current - 1)} aria-label="Previous page">
            <ChevronUp className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button type="button" className={toolButton} disabled={!doc || current >= numPages} onClick={() => goToPage(current + 1)} aria-label="Next page">
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </button>
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const p = parsePageJump(jumpText ?? "", numPages);
              if (p) goToPage(p);
              setJumpText(null);
            }}
          >
            <input
              aria-label="Page number"
              inputMode="numeric"
              disabled={!doc}
              value={jumpText ?? String(current)}
              onFocus={(e) => {
                setJumpText(String(current));
                e.currentTarget.select();
              }}
              onChange={(e) => setJumpText(e.target.value)}
              onBlur={() => setJumpText(null)}
              className="h-7 w-12 rounded-md border border-line bg-white px-1.5 text-center font-mono text-xs text-ink focus:border-brand-300 focus:outline-none"
            />
            <span className="font-mono">/ {numPages || "…"}</span>
          </form>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className={toolButton} disabled={!doc || zoom <= MIN_ZOOM} onClick={() => changeZoom(stepZoom(zoom, -1))} aria-label="Zoom out">
            <Minus className="h-3.5 w-3.5" aria-hidden />
          </button>
          <span className="w-11 text-center font-mono" aria-live="polite">
            {doc ? `${zoomPct}%` : "—"}
          </span>
          <button type="button" className={toolButton} disabled={!doc || zoom >= MAX_ZOOM} onClick={() => changeZoom(stepZoom(zoom, 1))} aria-label="Zoom in">
            <Plus className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            disabled={!doc || zoom === 1}
            onClick={() => changeZoom(1)}
            className="h-7 rounded-md border border-line bg-white px-2 text-xs text-ink-3 transition-colors hover:border-brand-300 hover:text-brand-700 disabled:opacity-40"
          >
            Fit width
          </button>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <a href={src} target="_blank" rel="noopener noreferrer" className={toolButton} title="Open in a new tab">
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">Open in a new tab</span>
          </a>
          <a href={`${src}?download=1`} download={name} className={toolButton} title="Download">
            <Download className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">Download</span>
          </a>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-paper-2"
        style={{ minHeight: 420 }}
      >
        {!doc ? (
          <div className="flex h-full min-h-[420px] items-center justify-center text-xs text-ink-4" role="status">
            Loading PDF…
          </div>
        ) : (
          <div className="flex flex-col items-center" style={{ paddingTop: PAD_TOP, paddingBottom: PAD_TOP, gap: PAGE_GAP }}>
            {pageTops.map((_, i) => {
              const page = i + 1;
              const size = sizeOf(page);
              return (
                <PdfPage
                  key={page}
                  pdfjs={pdfjs!}
                  doc={doc}
                  pageNumber={page}
                  scale={scale}
                  width={size.w}
                  height={size.h}
                  active={
                    (page >= range.first && page <= range.last) ||
                    (pinned !== null && page >= pinned.first && page <= pinned.last)
                  }
                  onSize={handlePageSize}
                  onTextLayer={handleLayer}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** One page: a sized placeholder that renders canvas + text layer
 *  while `active`, and clears both when it scrolls away. */
const PdfPage = memo(function PdfPage({
  pdfjs,
  doc,
  pageNumber,
  scale,
  width,
  height,
  active,
  onSize,
  onTextLayer,
}: {
  pdfjs: PdfJs;
  doc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  width: number;
  height: number;
  active: boolean;
  onSize: (page: number, size: Size) => void;
  onTextLayer: (page: number, layer: HTMLElement | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    const textDiv = textRef.current;
    if (!canvas || !textDiv) return;
    let cancelled = false;
    let renderTask: { cancel(): void; promise: Promise<unknown> } | null = null;
    let textLayer: InstanceType<PdfJs["TextLayer"]> | null = null;

    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const natural = page.getViewport({ scale: 1 });
      onSize(pageNumber, { w: natural.width, h: natural.height });
      const viewport = page.getViewport({ scale });
      const out = canvasOutputScale(viewport.width, viewport.height, window.devicePixelRatio);
      canvas.width = Math.floor(viewport.width * out);
      canvas.height = Math.floor(viewport.height * out);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      renderTask = page.render({
        canvas,
        viewport,
        transform: out !== 1 ? [out, 0, 0, out, 0, 0] : undefined,
      });
      textDiv.replaceChildren();
      textLayer = new pdfjs.TextLayer({
        textContentSource: page.streamTextContent(),
        container: textDiv,
        viewport,
      });
      await Promise.all([renderTask.promise, textLayer.render()]);
      if (cancelled) return;
      setFailed(false);
      onTextLayer(pageNumber, textDiv);
    })().catch((err: unknown) => {
      if (cancelled || (err as { name?: string })?.name === "RenderingCancelledException") return;
      console.warn(`PDF page ${pageNumber} failed to render`, err);
      setFailed(true);
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
      onTextLayer(pageNumber, null);
      // Free the bitmap + text when the page leaves the window.
      canvas.width = 0;
      canvas.height = 0;
      textDiv.replaceChildren();
    };
  }, [active, doc, pageNumber, scale, pdfjs, onSize, onTextLayer]);

  return (
    <div
      data-page-number={pageNumber}
      // The corner page number is CSS-generated content, not DOM text:
      // a selection (or highlight) running across a page break must
      // not pick it up as part of the quoted passage.
      className="relative shrink-0 bg-white shadow-sm ring-1 ring-line after:pointer-events-none after:absolute after:bottom-1 after:right-2 after:font-mono after:text-[10px] after:text-ink-4/70 after:content-[attr(data-page-number)]"
      style={
        {
          width,
          height,
          "--total-scale-factor": scale,
          "--scale-round-x": "1px",
          "--scale-round-y": "1px",
        } as React.CSSProperties
      }
    >
      <canvas ref={canvasRef} width={0} height={0} className="block" aria-hidden />
      <div ref={textRef} className="textLayer" />
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-ink-4">
          Page {pageNumber} couldn&apos;t be rendered.
        </div>
      )}
    </div>
  );
});
