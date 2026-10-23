import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateSubject, validateTemplateContent, type TemplateKind } from "./schema";

const text = (t: string, marks?: { type: string }[]) => ({
  type: "text",
  text: t,
  ...(marks ? { marks } : {}),
});
const para = (...content: unknown[]) => ({ type: "paragraph", content });
const doc = (...content: unknown[]) => ({ type: "doc", content });
const field = (path = "client.name", format: string | null = null, ifMissing?: "hide") => ({
  type: "field",
  attrs: { path, format, ...(ifMissing ? { ifMissing } : {}) },
});

const everything = doc(
  { type: "heading", attrs: { level: 2, textAlign: "center" }, content: [text("Hi")] },
  para(
    text("bold", [{ type: "bold" }, { type: "italic" }, { type: "underline" }]),
    { type: "hardBreak" },
    field(),
  ),
  { type: "paragraph" },
  para(field("client.name", null), {
    type: "listField",
    attrs: { list: "parties", itemPath: "name", join: "oxford_and" },
  }),
  {
    type: "bulletList",
    content: [
      {
        type: "listItem",
        content: [
          para(text("a")),
          { type: "orderedList", content: [{ type: "listItem", content: [para(text("b"))] }] },
        ],
      },
    ],
  },
  {
    type: "table",
    content: [
      {
        type: "tableRow",
        content: [
          {
            type: "tableHeader",
            attrs: { colspan: 1, rowspan: 1, colwidth: null },
            content: [para(text("h"))],
          },
          {
            type: "tableCell",
            attrs: { colspan: 1, rowspan: 1, colwidth: [100] },
            content: [para(text("c"))],
          },
        ],
      },
    ],
  },
  { type: "pageBreak" },
  { type: "block", attrs: { blockId: "b1" } },
  {
    type: "showIf",
    attrs: { path: "matter.type", op: "in", values: ["a", "b"] },
    content: [para(text("conditional"))],
  },
  {
    type: "repeat",
    attrs: { list: "parties" },
    content: [para(field("name")), { type: "repeatEmpty", content: [para(text("none"))] }],
  },
);

describe("validateTemplateContent", () => {
  it("accepts a letter with every node type", () => {
    const r = validateTemplateContent("letter", everything);
    expect(r).toMatchObject({ ok: true });
  });

  it("rejects block nodes when isBlock", () => {
    const r = validateTemplateContent("letter", everything, { isBlock: true });
    expect(r.ok).toBe(false);
    const ok = validateTemplateContent("letter", doc(para(text("x"))), { isBlock: true });
    expect(ok.ok).toBe(true);
  });

  it("restricts sms to paragraph/text/hardBreak/field with no marks", () => {
    expect(
      validateTemplateContent("sms", doc(para(text("a"), { type: "hardBreak" }, field()))),
    ).toMatchObject({ ok: true });
    expect(validateTemplateContent("sms", doc(para(text("a", [{ type: "bold" }])))).ok).toBe(false);
    expect(validateTemplateContent("sms", doc(para(field("x", null)))).ok).toBe(true);
    expect(
      validateTemplateContent("sms", doc(para({ ...field(), marks: [{ type: "bold" }] }))).ok,
    ).toBe(false);
    expect(
      validateTemplateContent(
        "sms",
        doc({ type: "heading", attrs: { level: 1 }, content: [text("h")] }),
      ).ok,
    ).toBe(false);
    expect(validateTemplateContent("sms", doc({ type: "pageBreak" })).ok).toBe(false);
  });

  it("allows marks on fields for non-sms kinds", () => {
    const d = doc(para({ ...field(), marks: [{ type: "bold" }] }));
    expect(validateTemplateContent("letter", d).ok).toBe(true);
  });

  it("rejects pageBreak for email but not letter/filing", () => {
    const d = doc({ type: "pageBreak" });
    expect(validateTemplateContent("email", d).ok).toBe(false);
    for (const k of ["letter", "filing"] as TemplateKind[]) {
      expect(validateTemplateContent(k, d).ok).toBe(true);
    }
  });

  it("rejects nesting deeper than 12", () => {
    const nest = (n: number): unknown =>
      n === 0
        ? para(text("x"))
        : {
            type: "showIf",
            attrs: { path: "a", op: "present", values: [] },
            content: [nest(n - 1)],
          };
    expect(validateTemplateContent("letter", doc(nest(5))).ok).toBe(true);
    const r = validateTemplateContent("letter", doc(nest(13)));
    expect(r.ok).toBe(false);
  });

  it("rejects content over 256 KB", () => {
    const big = doc(para(text("x".repeat(262_200))));
    expect(validateTemplateContent("letter", big)).toEqual({
      ok: false,
      error: "Template is too large.",
    });
  });

  it("allows cells merged across a row and down a column", () => {
    const cell = (attrs?: unknown) => ({ type: "tableCell", attrs, content: [para()] });
    const d = doc({
      type: "table",
      content: [
        { type: "tableRow", content: [cell({ colspan: 2 })] },
        { type: "tableRow", content: [cell(), cell({ rowspan: 2 })] },
        { type: "tableRow", content: [cell()] },
      ],
    });
    const r = validateTemplateContent("letter", d);
    expect(r.ok).toBe(true);
  });

  it("rejects merged cells that interlock", () => {
    const cell = (attrs?: unknown) => ({ type: "tableCell", attrs, content: [para()] });
    // A pinwheel round the centre cell: no clean row or column cut.
    const d = doc({
      type: "table",
      content: [
        { type: "tableRow", content: [cell({ colspan: 2 }), cell({ rowspan: 2 })] },
        { type: "tableRow", content: [cell({ rowspan: 2 }), cell()] },
        { type: "tableRow", content: [cell({ colspan: 2 })] },
      ],
    });
    expect(validateTemplateContent("letter", d)).toEqual({
      ok: false,
      error: "Some merged cells interlock and can't be laid out. Split one and try again.",
    });
  });

  describe("table layout attrs", () => {
    const table = (tableAttrs: unknown, cellAttrs: unknown) =>
      doc({
        type: "table",
        ...(tableAttrs === undefined ? {} : { attrs: tableAttrs }),
        content: [
          {
            type: "tableRow",
            content: [{ type: "tableCell", attrs: cellAttrs, content: [para()] }],
          },
        ],
      });
    const firstCell = (r: ReturnType<typeof validateTemplateContent>) => {
      if (!r.ok) throw new Error(r.error);
      const t = r.doc.content![0] as {
        attrs?: unknown;
        content: { content: { attrs?: unknown }[] }[];
      };
      return { table: t.attrs, cell: t.content[0].content[0].attrs };
    };

    it("keeps fit width, vertical alignment and non-thin borders; drops defaults", () => {
      const r = validateTemplateContent(
        "letter",
        table(
          { width: "fit" },
          {
            verticalAlign: "bottom",
            borders: { top: "thick", right: "none", bottom: "thin", left: null },
          },
        ),
      );
      expect(firstCell(r)).toEqual({
        table: { width: "fit" },
        cell: { verticalAlign: "bottom", borders: { top: "thick", right: "none" } },
      });
      const d = validateTemplateContent(
        "letter",
        table({ width: "full" }, { verticalAlign: "top", borders: { top: "thin" } }),
      );
      expect(firstCell(d)).toEqual({ table: undefined, cell: undefined });
    });

    it("drops a column width list that doesn't match the span", () => {
      const r = validateTemplateContent(
        "letter",
        table(undefined, { colspan: 2, colwidth: [100] }),
      );
      expect(firstCell(r).cell).toEqual({ colspan: 2, colwidth: null });
    });

    it.each([
      [{ width: "half" }, {}, "Invalid table width."],
      [undefined, { verticalAlign: "baseline" }, "Invalid vertical alignment."],
      [undefined, { borders: { top: "double" } }, "Invalid table borders."],
      [undefined, { borders: "none" }, "Invalid table borders."],
      [undefined, { colspan: 0 }, "Invalid merged cell."],
      [undefined, { colspan: 1.5 }, "Invalid merged cell."],
      [undefined, { colspan: 21 }, "Invalid merged cell."],
      [undefined, { colwidth: [-5] }, "Invalid table column width."],
      [undefined, { rowspan: 0 }, "Invalid merged cell."],
      [undefined, { rowspan: 1001 }, "Invalid merged cell."],
    ])("rejects table %j / cell %j", (t, cellAttrs, error) => {
      expect(validateTemplateContent("letter", table(t, cellAttrs))).toEqual({ ok: false, error });
    });
  });

  it("names unknown node types", () => {
    const r = validateTemplateContent("letter", doc({ type: "script" }));
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toContain("script");
  });

  it("rejects bad attrs and structure", () => {
    const bad = [
      doc({ type: "heading", attrs: { level: 4 }, content: [] }),
      doc({ type: "paragraph", attrs: { textAlign: "diagonal" } }),
      doc({ type: "showIf", attrs: { path: "a", op: "nope", values: [] }, content: [para()] }),
      doc({ type: "showIf", attrs: { path: "a", op: "present", values: [] }, content: [] }),
      doc({
        type: "repeat",
        attrs: { list: "l" },
        content: [{ type: "repeatEmpty", content: [] }],
      }),
      doc({
        type: "repeat",
        attrs: { list: "l" },
        content: [{ type: "repeatEmpty", content: [] }, para()],
      }),
      doc(para({ type: "listField", attrs: { list: "l", itemPath: "p", join: "x" } })),
      doc(para({ type: "field", attrs: { format: null } })),
      doc(para(text("x", [{ type: "strike" }]))),
      doc({ type: "pageBreak", content: [para()] }),
      doc({ type: "tableRow", content: [] }),
      { type: "paragraph" },
    ];
    for (const b of bad) expect(validateTemplateContent("letter", b).ok).toBe(false);
  });

  it("never throws on garbage", () => {
    for (const g of [
      null,
      undefined,
      1,
      "s",
      [],
      [1],
      {},
      { type: 5 },
      { type: "doc", content: "x" },
      { type: "doc", content: [null] },
      { type: "doc", content: [[]] },
    ]) {
      expect(() => validateTemplateContent("letter", g)).not.toThrow();
      expect(validateTemplateContent("letter", g).ok).toBe(false);
    }
  });
});

describe("validateSubject", () => {
  it("accepts one paragraph of text and fields", () => {
    expect(validateSubject(doc(para(text("Re: "), field("matter.name"))))).toMatchObject({
      ok: true,
    });
  });
  it("rejects anything else", () => {
    expect(validateSubject(doc(para(text("a")), para(text("b")))).ok).toBe(false);
    expect(validateSubject(doc(para({ type: "hardBreak" }))).ok).toBe(false);
    expect(validateSubject(doc({ type: "heading", attrs: { level: 1 }, content: [] })).ok).toBe(
      false,
    );
    expect(validateSubject(null).ok).toBe(false);
  });
});

describe("seeded default blocks", () => {
  it("pass block validation", () => {
    const sql = readFileSync(
      join(process.cwd(), "prisma/migrations/20261022120000_template_foundation/migration.sql"),
      "utf8",
    );
    const literals = [...sql.matchAll(/'(\{"type":"doc".*?\})'::jsonb/g)].map((m) => m[1]);
    expect(literals).toHaveLength(2);
    for (const lit of literals) {
      const json = JSON.parse(lit);
      const r = validateTemplateContent("letter", json, { isBlock: true });
      expect(r).toMatchObject({ ok: true });
    }
  });

  it("keeps a valid ordered list start and drops other list attrs", () => {
    const item = { type: "listItem", content: [para(text("b"))] };
    const run = (attrs: unknown) => {
      const r = validateTemplateContent("letter", {
        type: "doc",
        content: [{ type: "orderedList", attrs, content: [item] }],
      });
      return r.ok ? r.doc.content?.[0] : r;
    };
    expect(run({ start: 3, type: "a" })).toMatchObject({ attrs: { start: 3 } });
    expect(run({ start: 0 })).not.toHaveProperty("attrs");
    expect(run({ start: 1.5 })).not.toHaveProperty("attrs");
    expect(run({ type: "a" })).not.toHaveProperty("attrs");
  });

  it("keeps a field's ifMissing hide, drops null, and rejects other values", () => {
    const run = (ifMissing: unknown) => {
      const r = validateTemplateContent(
        "letter",
        doc(para({ type: "field", attrs: { path: "client.name", format: null, ifMissing } })),
      );
      return r.ok ? (r.doc.content?.[0] as { content: unknown[] }).content[0] : r;
    };
    expect(run("hide")).toEqual(field("client.name", null, "hide"));
    for (const v of [null, undefined]) expect(run(v)).toEqual(field());
    expect(run("show")).toMatchObject({ ok: false });
    expect(run("blank")).toMatchObject({ ok: false });
    expect(run(1)).toMatchObject({ ok: false });
  });
});

describe("paragraph styles and settings", () => {
  const p = (attrs: unknown, ...content: unknown[]) => ({ type: "paragraph", attrs, content });
  const attrsOf = (attrs: unknown) => {
    const r = validateTemplateContent("letter", doc(p(attrs, text("x"))));
    return r.ok ? (r.doc.content?.[0] as { attrs?: unknown }).attrs : r.error;
  };

  it("keeps a style key and valid settings", () => {
    const a = {
      textAlign: "center",
      style: "block-quote-2",
      spaceBeforePt: 6,
      spaceAfterPt: 12,
      lineSpacing: { exactPt: 14 },
      indentLeftIn: 0.5,
      indentRightIn: 0.25,
      firstLine: { kind: "hanging", in: 0.5 },
      keepWithNext: true,
      keepLinesTogether: true,
      pageBreakBefore: true,
    };
    expect(attrsOf(a)).toEqual(a);
  });

  it("keeps explicit overrides equal to the defaults", () => {
    const a = {
      spaceBeforePt: 0,
      spaceAfterPt: 0,
      indentLeftIn: 0,
      keepWithNext: false,
      pageBreakBefore: false,
      firstLine: { kind: "none" },
      style: "title",
    };
    expect(attrsOf(a)).toEqual(a);
    expect(attrsOf({ spaceBeforePt: 0 })).toEqual({ spaceBeforePt: 0 });
    expect(attrsOf({ spaceBeforePt: null, keepWithNext: null })).toBeUndefined();
  });

  it("rejects out-of-range settings with specific messages", () => {
    expect(attrsOf({ spaceBeforePt: 73 })).toBe("Invalid paragraph spacing.");
    expect(attrsOf({ lineSpacing: { exactPt: 2 } })).toBe("Invalid paragraph spacing.");
    expect(attrsOf({ indentLeftIn: 5 })).toBe("Invalid paragraph indent.");
    expect(attrsOf({ firstLine: { kind: "indent", in: -1 } })).toBe("Invalid paragraph indent.");
    expect(attrsOf({ keepWithNext: "yes" })).toBe("Invalid paragraph option.");
  });

  it("accepts unknown style keys but rejects malformed ones", () => {
    expect(attrsOf({ style: "deleted-style" })).toEqual({ style: "deleted-style" });
    expect(attrsOf({ style: "Bad Key" })).toBe("Invalid paragraph style.");
    expect(attrsOf({ style: "" })).toBe("Invalid paragraph style.");
    expect(attrsOf({ style: 3 })).toBe("Invalid paragraph style.");
  });

  it("styles apply inside table cells and show-if", () => {
    const r = validateTemplateContent(
      "letter",
      doc({
        type: "showIf",
        attrs: { path: "client.name", op: "present", values: [] },
        content: [
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [{ type: "tableCell", content: [p({ style: "caption" })] }],
              },
            ],
          },
        ],
      }),
    );
    expect(r.ok).toBe(true);
  });
});

describe("allCaps and fontSize marks", () => {
  const withMarks = (kind: TemplateKind, marks: unknown[]) =>
    validateTemplateContent(kind, doc(para(text("x", marks as { type: string }[]))));

  it("keeps allCaps and a valid fontSize", () => {
    const r = withMarks("letter", [
      { type: "allCaps" },
      { type: "fontSize", attrs: { pt: 7 + 5.5 } },
    ]);
    expect(r).toEqual({
      ok: true,
      doc: doc(
        para({
          type: "text",
          text: "x",
          marks: [{ type: "allCaps" }, { type: "fontSize", attrs: { pt: 12.5 } }],
        }),
      ),
    });
  });

  it("rejects fontSize outside 8-72 or off the 0.5 step", () => {
    for (const pt of [7.5, 73, 10.25, "12", undefined]) {
      const r = withMarks("letter", [{ type: "fontSize", attrs: { pt } }]);
      expect(r).toEqual({ ok: false, error: "Invalid font size." });
    }
    expect(withMarks("letter", [{ type: "fontSize" }])).toEqual({
      ok: false,
      error: "Invalid font size.",
    });
  });

  it("SMS rejects both new marks", () => {
    for (const m of [{ type: "allCaps" }, { type: "fontSize", attrs: { pt: 12 } }]) {
      expect(withMarks("sms", [m]).ok).toBe(false);
    }
  });
});
