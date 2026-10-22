/**
 * Small caps for outputs that can't draw them natively (the PDF): each
 * lowercase letter becomes a capital at `SMALL_CAPS_SCALE` of the size;
 * capitals, digits and punctuation keep full size. Word uses its own
 * small caps and the preview uses CSS `font-variant`.
 */

/** Size of a lowercase letter's capital, as a share of the run's size. */
export const SMALL_CAPS_SCALE = 0.8;

export type SmallCapsRun = { text: string; small: boolean };

export function smallCapsRuns(text: string): SmallCapsRun[] {
  const out: SmallCapsRun[] = [];
  for (const ch of text) {
    const upper = ch.toUpperCase();
    const small = upper !== ch;
    const last = out[out.length - 1];
    if (last && last.small === small) last.text += upper;
    else out.push({ text: upper, small });
  }
  return out;
}
