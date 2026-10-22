/**
 * Tiny dependency-free helpers shared by page-style and paragraph-styles
 * (kept apart so those two modules don't import each other).
 */

export const LINE_SPACINGS = ["single", "1.15", "1.5", "double"] as const;
export type LineSpacing = (typeof LINE_SPACINGS)[number];

/** Headings are bold at body size +6 / +4 / +2 pt. */
export function headingSizePt(sizePt: number, level: 1 | 2 | 3): number {
  return sizePt + (level === 1 ? 6 : level === 2 ? 4 : 2);
}
