import { describe, expect, test } from "vitest";
import {
  DEFAULT_DOCUMENT_STYLE,
  headingSizePt,
  PAGE_DIMENSIONS,
  type CourtFormatValues,
  resolvePageStyle,
  type DocumentStyleValues,
  type LoadedLogo,
} from "./page-style";

const STYLE: DocumentStyleValues = {
  ...DEFAULT_DOCUMENT_STYLE,
  fontKey: "palatino",
  fontSizeHalfPt: 25,
  lineSpacing: "double",
  spaceAfterPt: 6,
  marginTopIn: 1.25,
  marginRightIn: 0.75,
  marginBottomIn: 1.5,
  marginLeftIn: 2,
  letterheadBlockId: "lh",
  continuationBlockId: "cont",
  pageNumbers: "bottom_right",
  logoPosition: "center",
};
const LOGO: LoadedLogo = {
  bytes: new Uint8Array([1, 2]),
  contentType: "image/png",
  position: "center",
};

describe("resolvePageStyle", () => {
  test("letter keeps letterhead (with logo) and continuation", () => {
    const p = resolvePageStyle("letter", STYLE, LOGO);
    expect(p.kind).toBe("letter");
    expect(p.letterhead).toEqual({ blockId: "lh", logo: LOGO });
    expect(p.continuationBlockId).toBe("cont");
    expect(p.font).toBe("palatino");
    expect(p.sizePt).toBe(12.5);
    expect(p.lineSpacing).toBe(2);
    expect(p.spaceAfterPt).toBe(6);
    expect(p.marginsIn).toEqual({ top: 1.25, right: 0.75, bottom: 1.5, left: 2 });
    expect(p.pageNumbers).toBe("bottom_right");
  });

  test("letter with neither block nor logo has null letterhead", () => {
    const p = resolvePageStyle(
      "letter",
      { ...STYLE, letterheadBlockId: null, continuationBlockId: null },
      null,
    );
    expect(p.letterhead).toBeNull();
    expect(p.continuationBlockId).toBeNull();
  });

  test("letter with only a logo still has a letterhead", () => {
    const p = resolvePageStyle("letter", { ...STYLE, letterheadBlockId: null }, LOGO);
    expect(p.letterhead).toEqual({ blockId: null, logo: LOGO });
  });

  test("filing drops letterhead and continuation, keeps the rest", () => {
    const p = resolvePageStyle("filing", STYLE, LOGO);
    expect(p.letterhead).toBeNull();
    expect(p.continuationBlockId).toBeNull();
    expect(p.font).toBe("palatino");
    expect(p.marginsIn.left).toBe(2);
    expect(p.pageNumbers).toBe("bottom_right");
  });

  test.each([
    ["single", 1],
    ["1.15", 1.15],
    ["1.5", 1.5],
    ["double", 2],
  ] as const)("lineSpacing %s maps to %s", (ls, factor) => {
    expect(resolvePageStyle("letter", { ...STYLE, lineSpacing: ls }, null).lineSpacing).toBe(
      factor,
    );
  });
});

describe("headingSizePt", () => {
  test("adds 6 / 4 / 2 points", () => {
    expect(headingSizePt(12, 1)).toBe(18);
    expect(headingSizePt(12, 2)).toBe(16);
    expect(headingSizePt(12, 3)).toBe(14);
  });
});

const NULL_COURT: CourtFormatValues = {
  fontKey: null,
  fontSizeHalfPt: null,
  lineSpacing: null,
  spaceAfterPt: null,
  marginTopIn: null,
  marginRightIn: null,
  marginBottomIn: null,
  marginLeftIn: null,
  pageNumbers: null,
  paperSize: "letter",
  styleOverrides: {},
};

describe("court format layer", () => {
  test("filing takes each non-null court value, null keeps house values", () => {
    const court: CourtFormatValues = {
      ...NULL_COURT,
      fontKey: "arial",
      fontSizeHalfPt: 28,
      lineSpacing: "1.5",
      marginLeftIn: 1.5,
      pageNumbers: "none",
      paperSize: "legal",
    };
    const p = resolvePageStyle("filing", STYLE, null, court);
    expect(p.font).toBe("arial");
    expect(p.sizePt).toBe(14);
    expect(p.lineSpacing).toBe(1.5);
    expect(p.spaceAfterPt).toBe(6);
    expect(p.marginsIn).toEqual({ top: 1.25, right: 0.75, bottom: 1.5, left: 1.5 });
    expect(p.pageNumbers).toBe("none");
    expect(p.paperSize).toBe("legal");
  });

  test("all-null court keeps house style on letter paper", () => {
    const p = resolvePageStyle("filing", STYLE, null, NULL_COURT);
    expect(p).toEqual(resolvePageStyle("filing", STYLE, null));
    expect(p.paperSize).toBe("letter");
  });

  test("letters ignore the court", () => {
    const court = { ...NULL_COURT, fontKey: "arial", paperSize: "legal" } as const;
    const p = resolvePageStyle("letter", STYLE, LOGO, court);
    expect(p).toEqual(resolvePageStyle("letter", STYLE, LOGO));
    expect(p.paperSize).toBe("letter");
  });

  test("page dimensions", () => {
    expect(PAGE_DIMENSIONS.letter).toEqual({
      twips: { w: 12240, h: 15840 },
      pt: { w: 612, h: 792 },
      in: { w: 8.5, h: 11 },
    });
    expect(PAGE_DIMENSIONS.legal.twips).toEqual({ w: 12240, h: 20160 });
    expect(PAGE_DIMENSIONS.legal.pt.h).toBe(1008);
  });
});
