/**
 * Page style resolution — pure and client-safe (no server imports).
 * The firm's DocumentStyle row resolves into one PageStyle that both the
 * .docx and PDF converters (and the HTML preview) read.
 */

import { FONT_KEYS, type FontKey } from "./fonts";

export { FONT_KEYS };
export type { FontKey };

export const LINE_SPACINGS = ["single", "1.15", "1.5", "double"] as const;
export type LineSpacing = (typeof LINE_SPACINGS)[number];

export const PAGE_NUMBER_POSITIONS = ["none", "bottom_center", "bottom_right"] as const;
export type PageNumberPosition = (typeof PAGE_NUMBER_POSITIONS)[number];

export const LOGO_POSITIONS = ["none", "left", "center", "right"] as const;
export type LogoPosition = (typeof LOGO_POSITIONS)[number];

export const FONT_SIZE_HALF_PT_MIN = 20;
export const FONT_SIZE_HALF_PT_MAX = 28;
export const SPACE_AFTER_PT_MIN = 0;
export const SPACE_AFTER_PT_MAX = 24;
export const MARGIN_IN_MIN = 0.5;
export const MARGIN_IN_MAX = 2;
export const LOGO_MAX_BYTES = 1024 * 1024;

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
};

/** Mirrors the schema defaults (block ids are set by getDocumentStyle). */
export const DEFAULT_DOCUMENT_STYLE: DocumentStyleValues = {
  fontKey: "times",
  fontSizeHalfPt: 24,
  lineSpacing: "single",
  spaceAfterPt: 12,
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

export type PageStyle = {
  kind: "letter" | "filing";
  font: FontKey;
  sizePt: number;
  lineSpacing: 1 | 1.15 | 1.5 | 2;
  spaceAfterPt: number;
  marginsIn: { top: number; right: number; bottom: number; left: number };
  letterhead: { blockId: string | null; logo: LoadedLogo | null } | null;
  continuationBlockId: string | null;
  pageNumbers: PageNumberPosition;
};

const LINE_FACTOR: Record<LineSpacing, PageStyle["lineSpacing"]> = {
  single: 1,
  "1.15": 1.15,
  "1.5": 1.5,
  double: 2,
};

/** Letters get everything; filings keep font, size, spacing, margins and
 *  page numbers but no letterhead or continuation header. */
export function resolvePageStyle(
  kind: "letter" | "filing",
  style: DocumentStyleValues,
  logo: LoadedLogo | null,
): PageStyle {
  const isLetter = kind === "letter";
  const hasLetterhead = isLetter && (style.letterheadBlockId !== null || logo !== null);
  return {
    kind,
    font: style.fontKey,
    sizePt: style.fontSizeHalfPt / 2,
    lineSpacing: LINE_FACTOR[style.lineSpacing],
    spaceAfterPt: style.spaceAfterPt,
    marginsIn: {
      top: style.marginTopIn,
      right: style.marginRightIn,
      bottom: style.marginBottomIn,
      left: style.marginLeftIn,
    },
    letterhead: hasLetterhead ? { blockId: style.letterheadBlockId, logo } : null,
    continuationBlockId: isLetter ? style.continuationBlockId : null,
    pageNumbers: style.pageNumbers,
  };
}

/** Headings are bold at body size +6 / +4 / +2 pt. */
export function headingSizePt(sizePt: number, level: 1 | 2 | 3): number {
  return sizePt + (level === 1 ? 6 : level === 2 ? 4 : 2);
}
