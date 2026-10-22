import { describe, expect, test } from "vitest";
import { defaultParagraphStyles } from "./paragraph-styles";
import { DEFAULT_DOCUMENT_STYLE, resolvePageStyle, type CourtFormatValues } from "./page-style";
import { effectiveStyles, lineFactor, resolveParagraph } from "./resolve-styles";

const firm = defaultParagraphStyles({
  fontSizeHalfPt: 24,
  lineSpacing: "single",
  spaceAfterPt: 12,
});

describe("effectiveStyles", () => {
  test("court overrides beat firm values; unknown keys ignored; null is a no-op", () => {
    const out = effectiveStyles(firm, { body: { sizePt: 13 }, nope: { sizePt: 20 } });
    expect(out.find((s) => s.key === "body")!.values.sizePt).toBe(13);
    expect(out).toHaveLength(firm.length);
    expect(effectiveStyles(firm, null)).toBe(firm);
  });
});

describe("resolveParagraph", () => {
  test("paragraph setting beats court beats firm", () => {
    const styles = effectiveStyles(firm, { body: { spaceAfterPt: 8 } });
    expect(resolveParagraph("body", {}, styles).spaceAfterPt).toBe(8);
    expect(resolveParagraph("body", { spaceAfterPt: 3 }, styles).spaceAfterPt).toBe(3);
    expect(resolveParagraph("body", {}, firm).spaceAfterPt).toBe(12);
  });
  test("unknown key falls back to body, known false", () => {
    const r = resolveParagraph("gone", {}, firm);
    expect(r.known).toBe(false);
    expect(r.sizePt).toBe(12);
    expect(resolveParagraph("heading1", {}, firm).known).toBe(true);
  });
  test("hanging indent is clamped to the left indent", () => {
    const r = resolveParagraph(
      "body",
      { indentLeftIn: 0.5, firstLine: { kind: "hanging", in: 0.75 } },
      firm,
    );
    expect(r.firstLine).toEqual({ kind: "hanging", in: 0.5 });
  });
});

describe("lineFactor", () => {
  test("factors and null for exact", () => {
    expect(lineFactor("double")).toBe(2);
    expect(lineFactor("1.15")).toBe(1.15);
    expect(lineFactor({ exactPt: 14 })).toBeNull();
  });
});

describe("resolvePageStyle follows Body", () => {
  const court: CourtFormatValues = {
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
    styleOverrides: { body: { sizePt: 14, lineSpacing: { exactPt: 28 } } },
  };
  test("filing follows a court Body override; letters ignore it", () => {
    const f = resolvePageStyle("filing", DEFAULT_DOCUMENT_STYLE, null, court);
    expect(f.sizePt).toBe(14);
    expect(f.lineSpacing).toBe(2);
    expect(f.styles.find((s) => s.key === "body")!.values.sizePt).toBe(14);
    const l = resolvePageStyle("letter", DEFAULT_DOCUMENT_STYLE, null, court);
    expect(l.sizePt).toBe(12);
    expect(l.styles.find((s) => s.key === "body")!.values.sizePt).toBe(12);
  });
});
