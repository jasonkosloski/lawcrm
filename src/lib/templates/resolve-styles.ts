/**
 * Resolves paragraph styles: the firm's list, with a court format's sparse
 * overrides applied (filings only), then a paragraph's own settings on top.
 * Pure and client-safe.
 */

import type { LineSpacingValue, ParagraphStyle, StyleValues } from "./paragraph-styles";
import { LINE_SPACINGS } from "./style-basics";

/** Per-paragraph settings that beat the style (court beats firm, paragraph beats both). */
export type ParagraphSettings = Partial<
  Pick<
    StyleValues,
    | "align"
    | "spaceBeforePt"
    | "spaceAfterPt"
    | "lineSpacing"
    | "indentLeftIn"
    | "indentRightIn"
    | "firstLine"
    | "keepWithNext"
    | "keepLinesTogether"
    | "pageBreakBefore"
  >
>;

export type ResolvedParagraphStyle = StyleValues & { key: string; known: boolean };

/** The firm's styles with the court's per-style overrides merged in.
 *  Overrides for keys the firm doesn't have are ignored. */
export function effectiveStyles(
  firm: ParagraphStyle[],
  overrides: Record<string, Partial<StyleValues>> | null,
): ParagraphStyle[] {
  if (!overrides) return firm;
  return firm.map((s) => {
    const o = overrides[s.key];
    return o ? { ...s, values: { ...s.values, ...o } } : s;
  });
}

const FACTORS: Record<(typeof LINE_SPACINGS)[number], 1 | 1.15 | 1.5 | 2> = {
  single: 1,
  "1.15": 1.15,
  "1.5": 1.5,
  double: 2,
};

/** The multiplier for a line-spacing value; null for exact spacing. */
export function lineFactor(v: LineSpacingValue): number | null {
  return typeof v === "string" ? FACTORS[v] : null;
}

/** A style's values, a paragraph's settings on top. An unknown key falls
 *  back to Body (`known: false`). The first line never pushes text left of
 *  the margin: a hanging amount is capped at the left indent. */
export function resolveParagraph(
  styleKey: string | undefined,
  settings: ParagraphSettings,
  styles: ParagraphStyle[],
): ResolvedParagraphStyle {
  const found = styleKey ? styles.find((s) => s.key === styleKey) : undefined;
  const style = found ?? styles.find((s) => s.key === "body");
  if (!style) throw new Error("Paragraph styles are missing the built-in Body style.");
  const merged: StyleValues = { ...style.values };
  for (const [k, v] of Object.entries(settings)) {
    if (v !== undefined) (merged as Record<string, unknown>)[k] = v;
  }
  const fl = merged.firstLine;
  if (fl.kind === "hanging" && fl.in > merged.indentLeftIn) {
    merged.firstLine =
      merged.indentLeftIn > 0 ? { kind: "hanging", in: merged.indentLeftIn } : { kind: "none" };
  }
  return { ...merged, key: style.key, known: !!found };
}
