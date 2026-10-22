import { describe, expect, test } from "vitest";
import {
  DEFAULT_DOCUMENT_STYLE,
  headingSizePt,
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
