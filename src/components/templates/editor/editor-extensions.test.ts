// @vitest-environment happy-dom
/**
 * Template editor extensions: the editor must emit JSON that
 * validateTemplateContent accepts and load any valid JSON losslessly.
 */
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { fieldByPath, listByPath } from "@/lib/templates/catalog";
import { validateTemplateContent, type TemplateKind } from "@/lib/templates/schema";
import { createTemplateExtensions, templateJSON } from "./extensions";
import { fieldChipText, listFieldChipText } from "./field-node";
import { ruleHeaderText } from "./section-nodes";

const p = (...content: unknown[]) => ({
  type: "paragraph",
  attrs: { textAlign: null },
  content,
});
const t = (text: string, marks?: { type: string }[]) =>
  marks ? { type: "text", text, marks } : { type: "text", text };
const cell = (type: "tableCell" | "tableHeader", ...content: unknown[]) => ({
  type,
  attrs: { colspan: 1, rowspan: 1, colwidth: null },
  content,
});

const FULL_DOC = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1, textAlign: "center" }, content: [t("Title")] },
    p(
      t("Dear "),
      { type: "field", attrs: { path: "client.name", format: "full" }, marks: [{ type: "bold" }] },
      { type: "hardBreak" },
      t("styled", [{ type: "italic" }, { type: "underline" }]),
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
    extensions: createTemplateExtensions({ kind, isBlock, blocks: [] }),
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
          content: [{ type: "listItem", content: [p(t("x"))] }],
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
      createTemplateExtensions({ kind, isBlock, blocks: [] }).map((e) => e.name);
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
    expect(JSON.stringify(editor.getJSON())).not.toContain("pageBreak");
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
