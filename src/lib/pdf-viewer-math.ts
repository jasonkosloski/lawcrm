/**
 * Pure layout math for the built-in PDF viewer (pdf-document-viewer).
 * Kept out of the component so zoom steps, current-page tracking and
 * canvas sizing are unit-tested without a browser or pdf.js.
 */

/** Zoom multipliers the +/- buttons step through (1 = fit width). */
export const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;

export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

/** Next zoom step up (+1) or down (-1) from `current`. A current
 *  value between steps snaps to the neighbouring step in that
 *  direction; the ends clamp. */
export function stepZoom(current: number, direction: 1 | -1): number {
  if (direction === 1) {
    return ZOOM_STEPS.find((z) => z > current + 1e-6) ?? MAX_ZOOM;
  }
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    if (ZOOM_STEPS[i] < current - 1e-6) return ZOOM_STEPS[i];
  }
  return MIN_ZOOM;
}

/** Scale (CSS px per PDF point) at which a page fills the available
 *  width, less a gutter. Never below a readable floor; falls back to
 *  1 when the container hasn't been laid out yet (width 0). */
export function fitWidthScale(
  containerWidth: number,
  pageWidthPts: number,
  gutterPx = 32
): number {
  if (containerWidth <= 0 || pageWidthPts <= 0) return 1;
  return Math.max(0.25, (containerWidth - gutterPx) / pageWidthPts);
}

/**
 * The 1-based page under the reading line (`y`, measured in the same
 * coordinate space as `pageTops`). `pageTops[i]` is the top offset of
 * page i+1 and is ascending. The answer is the last page whose top is
 * at or above the line. Binary search, because a production can run
 * to thousands of pages and this runs on scroll.
 */
export function pageAtOffset(pageTops: readonly number[], y: number): number {
  if (pageTops.length === 0) return 1;
  let lo = 0;
  let hi = pageTops.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pageTops[mid] <= y) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans + 1;
}

/** Browsers refuse (or silently blank) very large canvases — iOS caps
 *  near 16.7M pixels. Leave headroom. */
export const MAX_CANVAS_PIXELS = 16_000_000;

/**
 * Device-pixel multiplier for a page canvas of `cssWidth` × `cssHeight`:
 * the screen's pixel ratio (sharp on retina), reduced only as far as
 * needed to stay under MAX_CANVAS_PIXELS at high zoom.
 */
export function canvasOutputScale(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number
): number {
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  const area = cssWidth * cssHeight;
  if (area <= 0) return dpr;
  const cap = Math.sqrt(MAX_CANVAS_PIXELS / area);
  return Math.min(dpr, cap);
}

/** Parse the page-jump box: a whole number within the document, or
 *  null for anything else. */
export function parsePageJump(text: string, numPages: number): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= numPages ? n : null;
}
