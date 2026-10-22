import { describe, expect, it, vi } from "vitest";
import {
  BUILT_IN_KEYS,
  defaultParagraphStyles,
  newStyleKey,
  paragraphStylesSchema,
  parseParagraphStyles,
  styleOverrideSchema,
  type ParagraphStyle,
} from "./paragraph-styles";

const HOUSE = { fontSizeHalfPt: 24, lineSpacing: "double" as const, spaceAfterPt: 8 };

function byKey(list: ParagraphStyle[], key: string): ParagraphStyle {
  const s = list.find((x) => x.key === key);
  if (!s) throw new Error(`missing ${key}`);
  return s;
}

describe("defaultParagraphStyles", () => {
  const list = defaultParagraphStyles(HOUSE);

  it("has every built-in once, marked builtIn, and passes the schema", () => {
    expect(list.map((s) => s.key)).toEqual([...BUILT_IN_KEYS]);
    expect(list.every((s) => s.builtIn)).toBe(true);
    expect(paragraphStylesSchema.safeParse(list).success).toBe(true);
    expect(list.map((s) => s.name)).toEqual([
      "Body",
      "Title",
      "Heading 1",
      "Heading 2",
      "Heading 3",
      "Caption",
      "Block quote",
      "Signature",
    ]);
  });

  it("mirrors the house style", () => {
    const body = byKey(list, "body").values;
    expect(body.sizePt).toBe(12);
    expect(body.lineSpacing).toBe("double");
    expect(body.spaceAfterPt).toBe(8);
    expect(body.spaceBeforePt).toBe(0);
    const h1 = byKey(list, "heading1").values;
    expect(h1.bold).toBe(true);
    expect(h1.sizePt).toBe(18);
    expect(h1.keepWithNext).toBe(true);
    expect(byKey(list, "heading3").values.sizePt).toBe(14);
    const quote = byKey(list, "blockquote").values;
    expect(quote.indentLeftIn).toBe(0.5);
    expect(quote.indentRightIn).toBe(0.5);
    expect(quote.lineSpacing).toBe("single");
    const title = byKey(list, "title").values;
    expect(title).toMatchObject({ bold: true, allCaps: true, align: "center", spaceAfterPt: 8 });
    expect(byKey(list, "signature").values.keepLinesTogether).toBe(true);
    expect(byKey(list, "caption").values.spaceAfterPt).toBe(0);
  });
});

describe("paragraphStylesSchema rejects", () => {
  const base = () => defaultParagraphStyles(HOUSE);
  const reject = (list: unknown) =>
    expect(paragraphStylesSchema.safeParse(list).success).toBe(false);
  const withValues = (patch: Record<string, unknown>) => {
    const l = base();
    l[0] = { ...l[0], values: { ...l[0].values, ...patch } };
    return l;
  };

  it("a missing built-in", () => reject(base().slice(1)));
  it("a duplicate key", () => reject([...base(), { ...base()[0], name: "Other" }]));
  it.each(["Has Space", "UPPER", "a_b", "../x", ""])("a malformed key %j", (key) =>
    reject([...base(), { key, name: "Custom", builtIn: false, values: base()[0].values }]),
  );
  it("a duplicate name, case-insensitively", () =>
    reject([
      ...base(),
      { key: "custom", name: "caption", builtIn: false, values: base()[0].values },
    ]));
  it("more than 50 styles", () => {
    const extra = Array.from({ length: 42 }, (_, i) => ({
      key: `c${i}`,
      name: `Custom ${i}`,
      builtIn: false,
      values: base()[0].values,
    }));
    expect(paragraphStylesSchema.safeParse([...base(), ...extra]).success).toBe(true);
    reject([...base(), ...extra, { ...extra[0], key: "c99", name: "Custom 99" }]);
  });
  it("size 7.5", () => reject(withValues({ sizePt: 7.5 })));
  it("size off the 0.5 step", () => reject(withValues({ sizePt: 12.25 })));
  it("space after 73", () => reject(withValues({ spaceAfterPt: 73 })));
  it("exactPt 5", () => reject(withValues({ lineSpacing: { exactPt: 5 } })));
  it("indentLeft 4.01", () => reject(withValues({ indentLeftIn: 4.01 })));
  it("a bad firstLine kind", () => reject(withValues({ firstLine: { kind: "weird", in: 1 } })));
  it("a name over 60 chars or empty", () => {
    reject([
      ...base(),
      { key: "c", name: "x".repeat(61), builtIn: false, values: base()[0].values },
    ]);
    reject([...base(), { key: "c", name: "", builtIn: false, values: base()[0].values }]);
  });
  it("a built-in key marked custom", () => {
    const l = base();
    l[0] = { ...l[0], builtIn: false };
    reject(l);
  });

  it("accepts exactPt 12 and hanging indents", () => {
    expect(
      paragraphStylesSchema.safeParse(
        withValues({ lineSpacing: { exactPt: 12 }, firstLine: { kind: "hanging", in: 0.5 } }),
      ).success,
    ).toBe(true);
  });
});

describe("styleOverrideSchema", () => {
  it("accepts a partial and rejects out-of-range values", () => {
    expect(styleOverrideSchema.safeParse({ spaceAfterPt: 0 }).success).toBe(true);
    expect(styleOverrideSchema.safeParse({ sizePt: 99 }).success).toBe(false);
  });
});

describe("parseParagraphStyles", () => {
  it("returns a valid list as-is", () => {
    const list = defaultParagraphStyles(HOUSE);
    expect(parseParagraphStyles(list, HOUSE)).toEqual(list);
  });

  it("falls back to defaults silently for null (the normal uncustomised state)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseParagraphStyles(null, HOUSE)).toEqual(defaultParagraphStyles(HOUSE));
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it.each([{}, [{ key: "body" }]])("falls back to defaults and warns on %j", (input) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseParagraphStyles(input, HOUSE)).toEqual(defaultParagraphStyles(HOUSE));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("newStyleKey", () => {
  it("slugs the name", () => {
    expect(newStyleKey("Numbered allegation", new Set())).toBe("numbered-allegation");
  });
  it("suffixes on collision", () => {
    const taken = new Set(["numbered-allegation"]);
    expect(newStyleKey("Numbered allegation", taken)).toBe("numbered-allegation-2");
    taken.add("numbered-allegation-2");
    expect(newStyleKey("Numbered allegation", taken)).toBe("numbered-allegation-3");
  });
  it("never returns a built-in key", () => {
    expect(newStyleKey("Body", new Set())).toBe("body-2");
  });
  it("falls back when the name has no usable characters", () => {
    expect(newStyleKey("!!!", new Set())).toBe("style");
  });
});
