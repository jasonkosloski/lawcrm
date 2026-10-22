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
const field = (path = "client.name", format: string | null = null) => ({
  type: "field",
  attrs: { path, format },
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

  it("rejects merged table cells", () => {
    const d = doc({
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [{ type: "tableCell", attrs: { colspan: 2 }, content: [para()] }],
        },
      ],
    });
    expect(validateTemplateContent("letter", d).ok).toBe(false);
    const d2 = doc({
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [{ type: "tableCell", attrs: { rowspan: 2 }, content: [para()] }],
        },
      ],
    });
    expect(validateTemplateContent("letter", d2).ok).toBe(false);
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
});
