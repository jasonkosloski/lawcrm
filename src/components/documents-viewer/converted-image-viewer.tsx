/**
 * Viewers for image formats browsers can't display natively, decoded
 * in the browser from the auth-gated download route:
 *
 *   TiffViewer — multi-page TIFF scans (discovery productions). UTIF.js
 *                decodes in a Web Worker (tiff-decode.worker.ts) so a
 *                hostile file can't hang the tab: the worker is killed
 *                after a timeout. Pages render as canvases as they
 *                arrive, stacked with page labels.
 *   HeicViewer — iPhone photos (HEIC/HEIF). heic-to (libheif in
 *                WebAssembly) converts to JPEG, shown in the normal
 *                ImageViewer (click to zoom).
 *
 * Both are loaded on demand (dynamic import / worker), so the decoder
 * code ships only to pages that show these files. Failures fall back
 * to the download card.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { ViewerFallbackCard } from "./fallback-card";
import { ImageViewer } from "./image-viewer";
import type { TiffMessage } from "./tiff-decode";

/** Same order of magnitude as the docx cap: big enough for real scans,
 *  small enough that the browser isn't asked to hold a GB. */
export const CONVERTED_IMAGE_MAX_BYTES = 100 * 1024 * 1024;
export const TIFF_MAX_PAGES = 300;
/** Per page: ~ a 600 dpi letter-size scan. */
export const TIFF_MAX_PAGE_PIXELS = 40_000_000;
const DECODE_TIMEOUT_MS = 60_000;

async function fetchBytes(src: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const res = await fetch(src, { signal });
  if (!res.ok) throw new Error(`download responded ${res.status}`);
  const length = Number(res.headers.get("content-length"));
  if (length > CONVERTED_IMAGE_MAX_BYTES) throw new TooBigError();
  const buf = await res.arrayBuffer();
  if (buf.byteLength > CONVERTED_IMAGE_MAX_BYTES) throw new TooBigError();
  return buf;
}

class TooBigError extends Error {}

function failureDetail(err: unknown, what: string): string {
  if (err instanceof TooBigError) {
    return `This ${what} is larger than ${CONVERTED_IMAGE_MAX_BYTES / (1024 * 1024)} MB — download it to view.`;
  }
  return `This ${what} couldn't be displayed. It may be corrupt or use an unsupported encoding — download it to view.`;
}

function Status({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      className="flex flex-1 items-center justify-center rounded-lg border border-line bg-paper-2 p-8 text-xs text-ink-4"
    >
      {children}
    </div>
  );
}

// ── TIFF ──────────────────────────────────────────────────────────────

type TiffPage =
  | { state: "pending" }
  | { state: "ready"; width: number; height: number; rgba: Uint8ClampedArray }
  | { state: "failed" };

export function TiffViewer({ src, name }: { src: string; name: string }) {
  const [pages, setPages] = useState<TiffPage[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let worker: Worker | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fail = (detail: string) => {
      worker?.terminate();
      setError(detail);
    };
    (async () => {
      let buffer: ArrayBuffer;
      try {
        buffer = await fetchBytes(src, controller.signal);
      } catch (err) {
        if (!controller.signal.aborted) fail(failureDetail(err, "TIFF"));
        return;
      }
      worker = new Worker(new URL("./tiff-decode.worker.ts", import.meta.url), { type: "module" });
      const arm = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => fail(failureDetail(null, "TIFF")), DECODE_TIMEOUT_MS);
      };
      arm();
      worker.onerror = () => fail(failureDetail(null, "TIFF"));
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data as TiffMessage;
        arm(); // progress resets the clock; a stuck page trips it
        switch (msg.type) {
          case "count":
            setTotal(msg.pages);
            setPages(Array.from({ length: msg.shown }, () => ({ state: "pending" })));
            break;
          case "page":
            setPages((p) =>
              p
                ? p.map((pg, i) =>
                    i === msg.index
                      ? { state: "ready", width: msg.width, height: msg.height, rgba: msg.rgba }
                      : pg,
                  )
                : p,
            );
            break;
          case "page-error":
            setPages((p) =>
              p ? p.map((pg, i) => (i === msg.index ? { state: "failed" } : pg)) : p,
            );
            break;
          case "done":
            if (timer) clearTimeout(timer);
            worker?.terminate();
            break;
          case "error":
            fail(failureDetail(null, "TIFF"));
            break;
        }
      };
      worker.postMessage({ buffer, maxPages: TIFF_MAX_PAGES, maxPixels: TIFF_MAX_PAGE_PIXELS }, [
        buffer,
      ]);
    })();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
      worker?.terminate();
    };
  }, [src]);

  if (error) {
    return (
      <ViewerFallbackCard
        title="Preview unavailable"
        detail={error}
        downloadHref={`${src}?download=1`}
        downloadName={name}
      />
    );
  }
  if (!pages) return <Status>Loading TIFF…</Status>;

  return (
    <div className="scrollbar-thin flex min-h-0 flex-1 flex-col items-center gap-3 overflow-auto rounded-lg border border-line bg-paper-2 p-4">
      {pages.map((p, i) => (
        <figure key={i} className="flex w-full max-w-4xl flex-col items-center gap-1">
          {p.state === "ready" ? (
            <TiffCanvas page={p} label={`${name}, page ${i + 1}`} />
          ) : (
            <div className="flex aspect-[8.5/11] w-full items-center justify-center bg-white text-xs text-ink-4 ring-1 ring-line">
              {p.state === "pending" ? "Decoding…" : `Page ${i + 1} couldn't be decoded.`}
            </div>
          )}
          {pages.length > 1 && (
            <figcaption className="font-mono text-2xs text-ink-4">
              Page {i + 1} of {total}
            </figcaption>
          )}
        </figure>
      ))}
      {total > pages.length && (
        <div className="text-2xs text-ink-4">
          Showing the first {pages.length} of {total} pages — download the file for the rest.
        </div>
      )}
    </div>
  );
}

function TiffCanvas({
  page,
  label,
}: {
  page: { width: number; height: number; rgba: Uint8ClampedArray };
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    canvas.width = page.width;
    canvas.height = page.height;
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(page.rgba), page.width, page.height),
      0,
      0,
    );
  }, [page]);
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label}
      className="h-auto w-full bg-white shadow-sm ring-1 ring-line"
      style={{ aspectRatio: `${page.width} / ${page.height}` }}
    />
  );
}

// ── HEIC ──────────────────────────────────────────────────────────────

export function HeicViewer({ src, name }: { src: string; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    (async () => {
      try {
        const buffer = await fetchBytes(src, controller.signal);
        const { heicTo } = await import("heic-to/next");
        const jpeg = await heicTo({
          blob: new Blob([buffer], { type: "image/heic" }),
          type: "image/jpeg",
          quality: 0.92,
        });
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(jpeg);
        setUrl(objectUrl);
      } catch (err) {
        if (!controller.signal.aborted) {
          console.warn("HEIC conversion failed", err);
          setError(failureDetail(err, "photo"));
        }
      }
    })();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (error) {
    return (
      <ViewerFallbackCard
        title="Preview unavailable"
        detail={error}
        downloadHref={`${src}?download=1`}
        downloadName={name}
      />
    );
  }
  if (!url) return <Status>Converting photo…</Status>;
  return <ImageViewer src={url} name={name} />;
}
