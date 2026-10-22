/**
 * Page style resolution — pure and client-safe (no server imports).
 * The firm's DocumentStyle row resolves into one PageStyle that both the
 * .docx and PDF converters (and the HTML preview) read.
 */

import { FONT_KEYS, type FontKey } from "./fonts";
import { defaultParagraphStyles, type ParagraphStyle, type StyleValues } from "./paragraph-styles";
import { effectiveStyles, lineFactor } from "./resolve-styles";
import { headingSizePt, LINE_SPACINGS, type LineSpacing } from "./style-basics";

export { FONT_KEYS };
export type { FontKey };

export { LINE_SPACINGS, headingSizePt };
export type { LineSpacing };

export const PAGE_NUMBER_POSITIONS = ["none", "bottom_center", "bottom_right"] as const;
export type PageNumberPosition = (typeof PAGE_NUMBER_POSITIONS)[number];

export const LOGO_POSITIONS = ["none", "left", "center", "right"] as const;
export type LogoPosition = (typeof LOGO_POSITIONS)[number];

export const PAPER_SIZES = ["letter", "legal"] as const;
export type PaperSize = (typeof PAPER_SIZES)[number];

export const COURT_SYSTEMS = ["state", "federal", "other"] as const;
export type CourtSystem = (typeof COURT_SYSTEMS)[number];

/** Page dimensions per paper size, in every unit a converter needs. */
export const PAGE_DIMENSIONS: Record<
  PaperSize,
  { twips: { w: number; h: number }; pt: { w: number; h: number }; in: { w: number; h: number } }
> = {
  letter: { twips: { w: 12240, h: 15840 }, pt: { w: 612, h: 792 }, in: { w: 8.5, h: 11 } },
  legal: { twips: { w: 12240, h: 20160 }, pt: { w: 612, h: 1008 }, in: { w: 8.5, h: 14 } },
};

export const FONT_SIZE_HALF_PT_MIN = 20;
export const FONT_SIZE_HALF_PT_MAX = 28;
export const SPACE_AFTER_PT_MIN = 0;
export const SPACE_AFTER_PT_MAX = 24;
export const MARGIN_IN_MIN = 0.5;
export const MARGIN_IN_MAX = 2;
export const LOGO_MAX_BYTES = 1024 * 1024;

/** Word's header distance: headers start this far from the page top
 *  (708 twips, Word's default, written explicitly into the .docx). The
 *  body starts at max(top margin, header distance + header height); the
 *  PDF and the preview follow the same rule. Footers mirror it. */
export const HEADER_DISTANCE_TWIPS = 708;
export const HEADER_DISTANCE_PT = HEADER_DISTANCE_TWIPS / 20;

/** Table cell padding, left and right, in both outputs (~0.08 in; Word's
 *  default cell margins are close to this). Top and bottom are 0. */
export const CELL_PAD_TWIPS = 115;
export const CELL_PAD_PT = CELL_PAD_TWIPS / 20;

/** The editable DocumentStyle columns, margins as plain numbers. */
export type DocumentStyleValues = {
  fontKey: FontKey;
  fontSizeHalfPt: number;
  lineSpacing: LineSpacing;
  spaceAfterPt: number;
  marginTopIn: number;
  marginRightIn: number;
  marginBottomIn: number;
  marginLeftIn: number;
  letterheadBlockId: string | null;
  logoPosition: LogoPosition;
  continuationBlockId: string | null;
  pageNumbers: PageNumberPosition;
  paragraphStyles: ParagraphStyle[];
};

/** A court format's layout overrides for filings; null = keep the house value. */
export type CourtFormatValues = {
  fontKey: FontKey | null;
  fontSizeHalfPt: number | null;
  lineSpacing: LineSpacing | null;
  spaceAfterPt: number | null;
  marginTopIn: number | null;
  marginRightIn: number | null;
  marginBottomIn: number | null;
  marginLeftIn: number | null;
  pageNumbers: PageNumberPosition | null;
  paperSize: PaperSize;
  /** Sparse per-style overrides keyed by style key. */
  styleOverrides: Record<string, Partial<StyleValues>>;
};

/** Mirrors the schema defaults (block ids are set by getDocumentStyle). */
export const DEFAULT_DOCUMENT_STYLE: DocumentStyleValues = {
  fontKey: "times",
  fontSizeHalfPt: 24,
  lineSpacing: "single",
  spaceAfterPt: 12,
  paragraphStyles: defaultParagraphStyles({
    fontSizeHalfPt: 24,
    lineSpacing: "single",
    spaceAfterPt: 12,
  }),
  marginTopIn: 1,
  marginRightIn: 1,
  marginBottomIn: 1,
  marginLeftIn: 1,
  letterheadBlockId: null,
  logoPosition: "none",
  continuationBlockId: null,
  pageNumbers: "bottom_center",
};

export type LoadedLogo = {
  bytes: Uint8Array;
  contentType: "image/png" | "image/jpeg";
  position: "left" | "center" | "right";
};

/** What a preview needs to know about the logo: where it goes, never its bytes. */
export type LogoRef = { position: LoadedLogo["position"] };

/** A page style carrying logo type `L`: the loaded bytes for the
 *  converters, or only a `LogoRef` for previews sent to the browser. */
export type PageStyleOf<L extends LogoRef> = {
  kind: "letter" | "filing";
  font: FontKey;
  sizePt: number;
  lineSpacing: 1 | 1.15 | 1.5 | 2;
  spaceAfterPt: number;
  /** The effective paragraph styles (court overrides applied for filings). */
  styles: ParagraphStyle[];
  marginsIn: { top: number; right: number; bottom: number; left: number };
  letterhead: { blockId: string | null; logo: L | null } | null;
  continuationBlockId: string | null;
  pageNumbers: PageNumberPosition;
  paperSize: PaperSize;
};

export type PageStyle = PageStyleOf<LoadedLogo>;
/** Serializable: safe to hand to a client component. */
export type PreviewPageStyle = PageStyleOf<LogoRef>;

/** Drops the logo bytes so the style can go over the wire. */
export function toPreviewPageStyle(style: PageStyleOf<LogoRef>): PreviewPageStyle {
  if (!style.letterhead) return style;
  const logo = style.letterhead.logo ? { position: style.letterhead.logo.position } : null;
  return { ...style, letterhead: { blockId: style.letterhead.blockId, logo } };
}

const LEGACY_FACTOR = { single: 1, "1.15": 1.15, "1.5": 1.5, double: 2 } as const;

/** Letters get everything; filings keep font, size, spacing, margins and
 *  page numbers but no letterhead or continuation header. A court format
 *  (filings only) overrides each value it sets and picks the paper size. */
export function resolvePageStyle(
  kind: "letter" | "filing",
  style: DocumentStyleValues,
  logo: LoadedLogo | null,
  court?: CourtFormatValues | null,
): PageStyle;
export function resolvePageStyle<L extends LogoRef>(
  kind: "letter" | "filing",
  style: DocumentStyleValues,
  logo: L | null,
  court?: CourtFormatValues | null,
): PageStyleOf<L>;
export function resolvePageStyle<L extends LogoRef>(
  kind: "letter" | "filing",
  style: DocumentStyleValues,
  logo: L | null,
  court?: CourtFormatValues | null,
): PageStyleOf<L> {
  const isLetter = kind === "letter";
  const c = !isLetter && court ? court : null;
  // Size/spacing come from Body (letters too); loaders keep Body in step with the legacy columns.
  const styles = effectiveStyles(style.paragraphStyles, c?.styleOverrides ?? null);
  const body = styles.find((x) => x.key === "body")?.values;
  const sizePt = body?.sizePt ?? style.fontSizeHalfPt / 2;
  // Exact line spacing has no factor; approximate it for the converters that
  // still read a factor (they move to per-paragraph values later).
  const factor = body ? lineFactor(body.lineSpacing) : LEGACY_FACTOR[style.lineSpacing];
  const lineSpacing = factor ?? (body!.lineSpacing as { exactPt: number }).exactPt / sizePt;
  const hasLetterhead = isLetter && (style.letterheadBlockId !== null || logo !== null);
  return {
    kind,
    font: c?.fontKey ?? style.fontKey,
    sizePt,
    lineSpacing: lineSpacing as PageStyle["lineSpacing"],
    spaceAfterPt: body?.spaceAfterPt ?? style.spaceAfterPt,
    styles,
    marginsIn: {
      top: c?.marginTopIn ?? style.marginTopIn,
      right: c?.marginRightIn ?? style.marginRightIn,
      bottom: c?.marginBottomIn ?? style.marginBottomIn,
      left: c?.marginLeftIn ?? style.marginLeftIn,
    },
    letterhead: hasLetterhead ? { blockId: style.letterheadBlockId, logo } : null,
    continuationBlockId: isLetter ? style.continuationBlockId : null,
    pageNumbers: c?.pageNumbers ?? style.pageNumbers,
    paperSize: c?.paperSize ?? "letter",
  };
}
