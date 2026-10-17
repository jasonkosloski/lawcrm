/**
 * Inline image renderer — centered, contained to the viewport by
 * default; click toggles a 1:1 "zoomed" view with scrolling for
 * evidence photos where detail matters.
 */

"use client";

import { useState } from "react";

export function ImageViewer({ src, name }: { src: string; name: string }) {
  const [zoomed, setZoomed] = useState(false);
  return (
    <div
      className={
        zoomed
          ? "flex-1 overflow-auto rounded-lg border border-line bg-paper-2 p-4"
          : "flex flex-1 items-center justify-center overflow-hidden rounded-lg border border-line bg-paper-2 p-4"
      }
    >
      {/* Storage bytes, not a Next-optimizable asset — the download
          route is auth-gated per request, so next/image's optimizer
          (a separate unauthenticated fetch) can't be used here. */}
      {/* The zoom toggle is a real button so keyboard and screen
          reader users can use it (a click handler on a bare <img>
          is neither focusable nor announced). */}
      <button
        type="button"
        aria-pressed={zoomed}
        aria-label={zoomed ? `Fit ${name} to window` : `Zoom ${name} to full size`}
        title={zoomed ? "Click to fit" : "Click to zoom"}
        onClick={() => setZoomed((z) => !z)}
        className={
          zoomed
            ? "cursor-zoom-out"
            : "flex max-h-full max-w-full cursor-zoom-in items-center justify-center"
        }
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={name}
          className={
            zoomed
              ? "max-w-none"
              : "max-h-full max-w-full object-contain"
          }
        />
      </button>
    </div>
  );
}
