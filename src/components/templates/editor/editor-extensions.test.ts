// @vitest-environment happy-dom
/**
 * Template editor extensions: the editor must emit JSON that
 * validateTemplateContent accepts and load any valid JSON losslessly.
 */
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { CellSelection } from "@tiptap/pm/tables";
import { convertHeadings } from "@/lib/templates/headings";
import { fieldByPath, listByPath } from "@/lib/templates/catalog";
import { validateTemplateContent, type TemplateKind } from "@/lib/templates/schema";
import { DEFAULT_PARAGRAPH_STYLES } from "@/lib/templates/page-style";
import { BODY_CLASS } from "./use-body-editor";
import { createTemplateExtensions, templateJSON } from "./extensions";
import { fieldChipText, listFieldChipText } from "./field-node";
import { ruleHeaderText } from "./section-nodes";

/** Every paragraph attr at its default: what the editor emits. */
const NO_ATTRS = {
  textAlign: null,
  style: null,
  spaceBeforePt: null,
  spaceAfterPt: null,
  lineSpacing: null,
  indentLeftIn: null,
  indentRightIn: null,
  firstLine: null,
  keepWithNext: null,
  keepLinesTogether: null,
  pageBreakBefore: null,
};
const p = (...content: unknown[]) => ({
  type: "paragraph",
  attrs: NO_ATTRS,
  content,
});
const t = (text: string, marks?: { type: string; attrs?: unknown }[]) =>
  marks ? { type: "text", text, marks } : { type: "text", text };
const cell = (type: "tableCell" | "tableHeader", ...content: unknown[]) => ({
  type,
  attrs: { colspan: 1, rowspan: 1, colwidth: null, verticalAlign: null, borders: null },
  content,
});

const FULL_DOC = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { ...NO_ATTRS, style: "heading1", textAlign: "center" },
      content: [t("Title")],
    },
    p(
      t("Dear "),
      { type: "field", attrs: { path: "client.name", format: "full" }, marks: [{ type: "bold" }] },
      { type: "hardBreak" },
      t("styled", [{ type: "italic" }, { type: "underline" }]),
      t(" Plaintiff", [{ type: "smallCaps" }]),
      { type: "field", attrs: { path: "matter.name", format: null } },
    ),
    p({
      type: "listField",
      attrs: { list: "parties.clients", itemPath: "name", join: "oxford_and" },
    }),
    { type: "bulletList", content: [{ type: "listItem", content: [p(t("one"))] }] },
    {
      type: "orderedList",
      attrs: { start: 1 },
      content: [{ type: "listItem", content: [p(t("first"))] }],
    },
    {
      type: "table",
      attrs: { width: null },
      content: [
        { type: "tableRow", content: [cell("tableHeader", p(t("H")))] },
        { type: "tableRow", content: [cell("tableCell", p(t("c")))] },
      ],
    },
    { type: "pageBreak" },
    { type: "block", attrs: { blockId: "blk1" } },
    {
      type: "showIf",
      attrs: { path: "matter.name", op: "in", values: ["a", "b"] },
      content: [p(t("cond"))],
    },
    {
      type: "repeat",
      attrs: { list: "parties.clients" },
      content: [
        p({ type: "field", attrs: { path: "item.name", format: null } }),
        { type: "repeatEmpty", content: [p(t("none"))] },
      ],
    },
  ],
};

const make = (kind: TemplateKind, content: unknown, isBlock = false) =>
  new Editor({
    extensions: createTemplateExtensions({
      styles: DEFAULT_PARAGRAPH_STYLES,
      kind,
      isBlock,
      blocks: [],
    }),
    content: content as never,
  });

describe("round trip", () => {
  it("loads every node type and emits identical, valid JSON", () => {
    const editor = make("letter", FULL_DOC);
    const json = editor.getJSON();
    expect(validateTemplateContent("letter", json).ok).toBe(true);
    expect(json).toEqual(FULL_DOC);
    editor.destroy();
  });

  it("round trips an ordered list start", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { start: 3 },
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", attrs: { textAlign: null }, content: [t("x")] }],
            },
          ],
        },
      ],
    };
    const editor = make("letter", doc);
    const out = validateTemplateContent("letter", editor.getJSON());
    expect(out.ok && out.doc).toEqual(doc);
    editor.destroy();
  });

  it("omits the block node inside a block and the page break in email", () => {
    const names = (kind: TemplateKind, isBlock: boolean) =>
      createTemplateExtensions({ styles: DEFAULT_PARAGRAPH_STYLES, kind, isBlock, blocks: [] }).map(
        (e) => e.name,
      );
    expect(names("letter", true)).not.toContain("block");
    expect(names("letter", false)).toContain("block");
    expect(names("email", false)).not.toContain("pageBreak");
  });
});

describe("clipboard and email", () => {
  it("round trips every custom node through HTML (copy/paste)", () => {
    const editor = make("letter", FULL_DOC);
    const html = editor.getHTML();
    editor.commands.setContent(html);
    expect(editor.getJSON()).toEqual(FULL_DOC);
    editor.destroy();
  });

  it("email keeps listField and drops pageBreak", () => {
    const emailDoc = {
      type: "doc",
      content: [
        p({
          type: "listField",
          attrs: { list: "parties.clients", itemPath: "name", join: "and" },
        }),
      ],
    };
    const editor = make("email", emailDoc);
    expect(editor.getJSON()).toEqual(emailDoc);
    expect(validateTemplateContent("email", editor.getJSON()).ok).toBe(true);
    editor.commands.setContent("<p>a</p><hr data-page-break>");
    expect(JSON.stringify(editor.getJSON())).not.toContain('"type":"pageBreak"');
    editor.destroy();
  });
});

describe("sms", () => {
  it("has only document, paragraph, text, hardBreak and field in its schema", () => {
    const editor = make("sms", "<p>hi</p>");
    expect(Object.keys(editor.schema.nodes).sort()).toEqual([
      "doc",
      "field",
      "hardBreak",
      "paragraph",
      "text",
    ]);
    expect(Object.keys(editor.schema.marks)).toEqual([]);
    editor.destroy();
  });

  it("drops a heading", () => {
    const editor = make("sms", "<h1>Hi</h1><p>there</p>");
    const json = JSON.stringify(editor.getJSON());
    expect(json).not.toContain("heading");
    expect(json).toContain("Hi");
    expect(validateTemplateContent("sms", editor.getJSON()).ok).toBe(true);
    editor.destroy();
  });
});

describe("commands", () => {
  it("insertField produces the expected node", () => {
    const editor = make("letter", "<p></p>");
    editor.commands.insertField("client.name", "full");
    const para = editor.getJSON().content?.[0];
    expect(para?.content?.[0]).toEqual({
      type: "field",
      attrs: { path: "client.name", format: "full" },
    });
    editor.destroy();
  });

  it("wrapInShowIf, insertBlock and insertPageBreak emit valid JSON", () => {
    const editor = make("letter", "<p>hello</p>");
    editor.commands.setTextSelection(2);
    editor.commands.wrapInShowIf({ path: "matter.name", op: "present", values: [] });
    editor.commands.insertBlock("b1");
    editor.commands.insertPageBreak();
    const json = editor.getJSON();
    expect(json.content?.map((n) => n.type)).toContain("showIf");
    expect(JSON.stringify(json)).toContain('"blockId":"b1"');
    expect(JSON.stringify(json)).toContain("pageBreak");
    expect(validateTemplateContent("letter", json).ok).toBe(true);
    editor.destroy();
  });

  it("wrapInRepeat wraps the selection", () => {
    const editor = make("letter", "<p>hello</p>");
    editor.commands.setTextSelection(2);
    editor.commands.wrapInRepeat("parties.clients");
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: "repeat",
      attrs: { list: "parties.clients" },
    });
    expect(validateTemplateContent("letter", editor.getJSON()).ok).toBe(true);
    editor.destroy();
  });

  it("addRepeatEmpty appends an If none branch once", () => {
    const editor = make("letter", "<p>hello</p>");
    editor.commands.setTextSelection(2);
    editor.commands.wrapInRepeat("parties.clients");
    expect(editor.commands.addRepeatEmpty(0)).toBe(true);
    expect(editor.commands.addRepeatEmpty(0)).toBe(false);
    const json = editor.getJSON();
    expect(json.content?.[0].content?.at(-1)?.type).toBe("repeatEmpty");
    expect(validateTemplateContent("letter", json).ok).toBe(true);
    editor.destroy();
  });

  it("updateNodeAttrs changes a field's attrs", () => {
    const editor = make("letter", FULL_DOC);
    let pos = -1;
    editor.state.doc.descendants((n, p0) => {
      if (n.type.name === "field" && pos < 0) pos = p0;
    });
    editor.commands.updateNodeAttrs(pos, { format: "first" });
    expect(JSON.stringify(editor.getJSON())).toContain('"format":"first"');
    editor.destroy();
  });
});

describe("labels", () => {
  const nameLabel = fieldByPath("client.name")!.label;
  it("field chip text", () => {
    expect(fieldChipText("client.name", "full")).toBe(`${nameLabel} · Full name`);
    expect(fieldChipText("client.name", null)).toBe(nameLabel);
    expect(fieldChipText("nope.path", null)).toBe("nope.path");
    expect(
      listFieldChipText({ list: "parties.clients", itemPath: "name", join: "lines" }),
    ).toContain(listByPath("parties.clients")!.label);
  });

  it("rule header text", () => {
    const label = fieldByPath("matter.name")!.label;
    const base = { path: "matter.name", values: [] as string[] };
    expect(ruleHeaderText({ ...base, op: "present" })).toBe(`Show if: ${label} is filled in`);
    expect(ruleHeaderText({ ...base, op: "empty" })).toBe(`Show if: ${label} is empty`);
    expect(ruleHeaderText({ ...base, op: "true" })).toBe(`Show if: ${label} is yes`);
    expect(ruleHeaderText({ ...base, op: "false" })).toBe(`Show if: ${label} is no`);
    expect(ruleHeaderText({ path: "x.y", op: "in", values: ["a", "b"] })).toBe(
      "Show if: x.y is one of a, b",
    );
  });
});

describe("templateJSON", () => {
  it("returns plain objects a server action can carry (inserted tables share null-prototype attrs)", () => {
    const editor = make("letter", { type: "doc", content: [p()] });
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
    const protos: unknown[] = [];
    const walk = (n: { attrs?: object; content?: unknown[] }) => {
      if (n.attrs) protos.push(Object.getPrototypeOf(n.attrs));
      n.content?.forEach((c) => walk(c as typeof n));
    };
    walk(templateJSON(editor));
    expect(protos.length).toBeGreaterThan(0);
    expect(protos.every((pr) => pr === Object.prototype)).toBe(true);
    expect(validateTemplateContent("letter", templateJSON(editor)).ok).toBe(true);
  });
});

describe("paragraph styles and text marks", () => {
  const SETTINGS = {
    style: "caption",
    textAlign: "justify",
    spaceBeforePt: 0,
    spaceAfterPt: 6,
    lineSpacing: { exactPt: 14 },
    indentLeftIn: 0.5,
    indentRightIn: 0,
    firstLine: { kind: "hanging", in: 0.25 },
    keepWithNext: false,
    keepLinesTogether: true,
    pageBreakBefore: true,
  };
  const doc = (attrs: Record<string, unknown>, ...content: unknown[]) => ({
    type: "doc",
    content: [{ type: "paragraph", attrs, content }],
  });
  const marked = [
    t("x", [{ type: "allCaps" }]),
    t("y", [{ type: "fontSize", attrs: { pt: 14 } }]),
    t("z", [{ type: "bold" }, { type: "allCaps" }]),
  ];

  it("round trips the style, every setting and both marks through JSON", () => {
    const d = doc(SETTINGS, ...marked);
    const editor = make("letter", d);
    expect(editor.getJSON()).toEqual(d);
    const out = validateTemplateContent("letter", editor.getJSON());
    expect(out.ok).toBe(true);
    editor.destroy();
  });

  it("round trips through HTML losslessly, including explicit zeros and false", () => {
    const d = doc(SETTINGS, ...marked);
    const editor = make("letter", d);
    const html = editor.getHTML();
    expect(html).toContain('data-style="caption"');
    editor.commands.setContent(html);
    expect(editor.getJSON()).toEqual(d);
    editor.destroy();
  });

  it("does not leak the displayed inline style back into attrs", () => {
    const editor = make("letter", doc({ ...NO_ATTRS, style: "heading1" }, t("Hi")));
    const html = editor.getHTML();
    expect(html).toContain("font-size");
    editor.commands.setContent(html);
    const attrs = editor.getJSON().content?.[0]?.attrs;
    expect(attrs).toEqual({ ...NO_ATTRS, style: "heading1" });
    editor.destroy();
  });

  it("shows the effective style inline", () => {
    const editor = make("letter", doc({ ...NO_ATTRS, style: "heading1", spaceAfterPt: 3 }, t("H")));
    const html = editor.getHTML();
    expect(html).toContain("--p-weight: bold");
    expect(html).toContain("3pt");
    editor.destroy();
  });

  it("loads a converted heading as a Heading 1 paragraph", () => {
    const legacy = {
      type: "doc",
      content: [{ type: "heading", attrs: { level: 1, textAlign: "center" }, content: [t("T")] }],
    };
    const editor = make("letter", convertHeadings(legacy as never));
    const first = editor.getJSON().content?.[0];
    expect(first?.type).toBe("paragraph");
    expect(first?.attrs).toMatchObject({ style: "heading1", textAlign: "center" });
    editor.destroy();
  });

  it("templateJSON leaves unset style and settings out but keeps explicit zeros", () => {
    const editor = make("letter", doc({ ...NO_ATTRS, spaceAfterPt: 0 }, t("x")));
    const attrs = templateJSON(editor).content?.[0];
    expect(attrs).toMatchObject({ attrs: { spaceAfterPt: 0 } });
    expect(JSON.stringify(attrs)).not.toContain('"style"');
    expect(JSON.stringify(attrs)).not.toContain("spaceBeforePt");
    editor.destroy();
  });

  it("has no heading node in rich kinds", () => {
    const names = createTemplateExtensions({
      styles: DEFAULT_PARAGRAPH_STYLES,
      kind: "letter",
      isBlock: false,
      blocks: [],
    }).map((e) => e.name);
    expect(names).not.toContain("heading");
  });

  it("clearFormatting removes marks and settings but keeps the style", () => {
    const editor = make("letter", doc(SETTINGS, ...marked));
    editor.commands.selectAll();
    editor.commands.clearFormatting();
    expect(editor.getJSON()).toEqual(doc({ ...NO_ATTRS, style: "caption" }, t("xyz")));
    editor.destroy();
  });

  it("setParagraphStyle and setParagraphSettings change the selected paragraph", () => {
    const editor = make("letter", doc(NO_ATTRS, t("x")));
    editor.commands.selectAll();
    editor.commands.setParagraphStyle("heading2");
    editor.commands.setParagraphSettings({ spaceAfterPt: 0, firstLine: { kind: "none" } });
    expect(editor.getJSON().content?.[0]?.attrs).toMatchObject({
      style: "heading2",
      spaceAfterPt: 0,
      firstLine: { kind: "none" },
    });
    editor.commands.setParagraphSettings({ spaceAfterPt: null });
    expect(editor.getJSON().content?.[0]?.attrs?.spaceAfterPt).toBeNull();
    editor.commands.setTextAlign("right");
    expect(editor.getJSON().content?.[0]?.attrs?.textAlign).toBe("right");
    editor.destroy();
  });

  it("style, settings and clear formatting reach every paragraph of a cell selection", () => {
    const table = {
      type: "table",
      attrs: { width: null },
      content: [
        {
          type: "tableRow",
          content: [
            cell("tableCell", p(t("a", [{ type: "bold" }]))),
            cell("tableCell", p(t("b", [{ type: "italic" }]))),
          ],
        },
      ],
    };
    const editor = make("letter", { type: "doc", content: [table] });
    const cells: number[] = [];
    editor.state.doc.descendants((n, pos) => {
      if (n.type.name === "tableCell") cells.push(pos);
    });
    const select = () =>
      editor.view.dispatch(
        editor.state.tr.setSelection(CellSelection.create(editor.state.doc, cells[0], cells[1])),
      );
    const paras = () => {
      const out: { attrs: Record<string, unknown>; marks: unknown }[] = [];
      editor.state.doc.descendants((n) => {
        if (n.type.name === "paragraph")
          out.push({ attrs: n.attrs, marks: n.firstChild?.marks.map((m) => m.type.name) });
      });
      return out;
    };
    select();
    editor.commands.setParagraphStyle("caption");
    editor.commands.setParagraphSettings({ spaceAfterPt: 4 });
    expect(paras().map((x) => [x.attrs.style, x.attrs.spaceAfterPt])).toEqual([
      ["caption", 4],
      ["caption", 4],
    ]);
    select();
    editor.commands.clearFormatting();
    expect(paras().map((x) => [x.attrs.style, x.attrs.spaceAfterPt, x.marks])).toEqual([
      ["caption", null, []],
      ["caption", null, []],
    ]);
    editor.destroy();
  });

  it("toggleAllCaps and setFontSize apply and remove their marks", () => {
    const editor = make("letter", doc(NO_ATTRS, t("x")));
    editor.commands.selectAll();
    editor.commands.toggleAllCaps();
    editor.commands.setFontSize(18);
    expect(editor.getJSON().content?.[0]?.content?.[0]?.marks).toEqual([
      { type: "allCaps" },
      { type: "fontSize", attrs: { pt: 18 } },
    ]);
    editor.commands.toggleAllCaps();
    editor.commands.setFontSize(null);
    expect(editor.getJSON().content?.[0]?.content?.[0]?.marks).toBeUndefined();
    editor.destroy();
  });

  it("cell paragraphs only carry data-space-after for a direct value, and BODY_CLASS zeroes the rest", () => {
    const cellDoc = (attrs: Record<string, unknown>) => ({
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [cell("tableCell", { type: "paragraph", attrs, content: [t("c")] })],
            },
          ],
        },
      ],
    });
    const none = make("letter", cellDoc(NO_ATTRS));
    expect(none.getHTML()).not.toContain("data-space-after");
    none.destroy();
    const zero = make("letter", cellDoc({ ...NO_ATTRS, spaceAfterPt: 0 }));
    expect(zero.getHTML()).toContain('data-space-after="0"');
    zero.destroy();
    expect(BODY_CLASS).toContain("[&_td>p:not([data-space-after])]:!mb-0");
    // List items keep their style's space after (R5), so no flush rule for them.
    expect(BODY_CLASS).not.toContain("li>p");
  });

  it("setParagraphStyle('body') unsets the style", () => {
    const editor = make("letter", doc({ ...NO_ATTRS, style: "heading1" }, t("x")));
    editor.commands.selectAll();
    editor.commands.setParagraphStyle("body");
    expect(templateJSON(editor).content?.[0]).not.toHaveProperty("attrs.style");
    editor.destroy();
  });
});
