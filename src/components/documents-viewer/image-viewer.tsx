/**
 * Inline image renderer — the whole picture fitted to the pane (both
 * ways, however large) by default; click toggles a 1:1 "zoomed" view
 * with scrolling for evidence photos where detail matters. Also shows
 * converted HEIC photos (HeicViewer passes an object URL).
 */

"use client";

import { useState } from "react";

export function ImageViewer({ src, name }: { src: string; name: string }) {
  const [zoomed, setZoomed] = useState(false);
  const toggle = (label: string, title: string, className: string, imgClassName: string) => (
    // The zoom toggle is a real button so keyboard and screen reader
    // users can use it (a click handler on a bare <img> is neither
    // focusable nor announced).
    <button
      type="button"
      aria-pressed={zoomed}
      aria-label={label}
      title={title}
      onClick={() => setZoomed((z) => !z)}
      className={className}
    >
      {/* Storage bytes, not a Next-optimizable asset — the download
          route is auth-gated per request, so next/image's optimizer
          (a separate unauthenticated fetch) can't be used here. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={name} className={imgClassName} />
    </button>
  );

  if (zoomed) {
    // 1:1 — the picture at its real size, scrolling both ways.
    return (
      <div className="min-h-[420px] flex-1 overflow-auto rounded-lg border border-line bg-paper-2 p-4">
        {toggle(
          `Fit ${name} to window`,
          "Click to fit",
          "block cursor-zoom-out",
          "block max-w-none",
        )}
      </div>
    );
  }

  // Fit: the image is laid out against the pane's own box (absolute
  // inset + object-contain), so a tall or very large photo shrinks to
  // fit both ways. Percentage max-heights inside the flex column didn't
  // resolve, which scaled big images to the width and cropped the rest.
  return (
    <div className="relative min-h-[420px] flex-1 overflow-hidden rounded-lg border border-line bg-paper-2">
      {toggle(
        `Zoom ${name} to full size`,
        "Click to zoom",
        "absolute inset-4 cursor-zoom-in",
        "h-full w-full object-contain",
      )}
    </div>
  );
}
