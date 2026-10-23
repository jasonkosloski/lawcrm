// @vitest-environment happy-dom
/**
 * Preset parity: each editor preset must emit only what its server-side
 * gate (sanitizer / template schema) accepts, or content silently
 * disappears on save.
 */
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { sanitizeOutgoingEmailHtml, sanitizeUserHtml } from "@/lib/sanitize-html";
import { validateTemplateContent } from "@/lib/templates/schema";
import { DEFAULT_PARAGRAPH_STYLES } from "@/lib/templates/page-style";
import { templateJSON } from "@/components/templates/editor/extensions";
import { FULL_DOC, NO_ATTRS, cell, p, t } from "@/components/templates/editor/test-fixtures";
import { renderFixture } from "@/lib/templates/converters-fixture";
import { resolvedToHtml } from "@/lib/templates/to-html";
import { documentExtensions, emailExtensions, notesExtensions } from "./presets";

describe("notes preset", () => {
  const make = (content: string) => new Editor({ extensions: notesExtensions(), content });

  it("horizontal rule is not part of the schema (a typed --- can't emit <hr>)", () => {
    const editor = make("<p>a</p>");
    expect(editor.schema.nodes.horizontalRule).toBeUndefined();
    expect(make("<p>a</p><hr><p>b</p>").getHTML()).not.toContain("<hr");
    editor.destroy();
  });

  it("everything the editor can emit survives sanitizeUserHtml unchanged", () => {
    const editor = make(
      [
        "<h2>Heading</h2>",
        "<h3>Sub</h3>",
        "<p><strong>b</strong> <em>i</em> <s>s</s> <code>c</code></p>",
        "<blockquote><p>q</p></blockquote>",
        "<ul><li><p>one</p></li></ul>",
        "<ol><li><p>two</p></li></ol>",
        "<pre><code>block</code></pre>",
        // StarterKit also ships underline.
        "<p><u>u</u></p>",
      ].join(""),
    );
    const html = editor.getHTML();
    expect(html).toContain("<h2>");
    expect(html).toContain("<blockquote>");
    expect(sanitizeUserHtml(html)).toBe(html);
    editor.destroy();
  });

  const roundTrip = (html: string) => {
    const editor = make(html);
    const out = editor.getHTML().replace(/<br ?\/?>/g, "<br>");
    const clean = sanitizeUserHtml(out).replace(/<br ?\/?>/g, "<br>");
    editor.destroy();
    return { out, clean };
  };

  it("a hard break survives the sanitizer", () => {
    const { out, clean } = roundTrip("<p>a<br>b</p>");
    expect(out).toContain("<br>");
    expect(clean).toBe(out);
  });

  it("a code block with a language loses only the class in the sanitizer", () => {
    const { out, clean } = roundTrip('<pre><code class="language-js">x</code></pre>');
    expect(out).toContain('class="language-js"');
    // stripped today: the sanitizer drops the language class (the code survives).
    expect(clean).toBe("<pre><code>x</code></pre>");
  });

  it("an ordered list with a start survives the sanitizer", () => {
    const { out, clean } = roundTrip('<ol start="3"><li><p>x</p></li></ol>');
    expect(out).toContain('start="3"');
    expect(clean).toBe(out);
  });

  it("a nested list survives the sanitizer", () => {
    const { out, clean } = roundTrip(
      "<ul><li><p>a</p><ul><li><p>b</p><ol><li><p>c</p></li></ol></li></ul></li></ul>",
    );
    expect(clean).toBe(out);
  });

  it("link output keeps href, target and rel through the sanitizer (which adds nofollow)", () => {
    const editor = make('<p><a href="https://example.com">l</a></p>');
    const clean = sanitizeUserHtml(editor.getHTML());
    expect(clean).toContain('href="https://example.com"');
    expect(clean).toContain('target="_blank"');
    expect(clean).toMatch(/rel="[^"]*noopener[^"]*"/);
    editor.destroy();
  });

  it("has no table or text-align extension", () => {
    const editor = make("<p>a</p>");
    const all = editor.extensionManager.extensions.map((e) => e.name);
    for (const banned of ["table", "textAlign"]) {
      expect(all).not.toContain(banned);
    }
    editor.destroy();
  });
});

/** Drop null/undefined attrs and empty `attrs: {}` so absent and null compare equal. */
function stripNulls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripNulls);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      if (val === null || val === undefined) continue;
      const c = stripNulls(val);
      if (k === "attrs" && c && Object.keys(c as object).length === 0) continue;
      out[k] = c;
    }
    return out;
  }
  return v;
}

/** Non-null values that a lossy schema pair could drop. */
const RICH_DOC = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: {
        ...NO_ATTRS,
        style: "heading1",
        textAlign: "right",
        spaceBeforePt: 6,
        indentLeftIn: 0.5,
        firstLine: { kind: "hanging", in: 0.25 },
      },
      content: [
        t("marks", [{ type: "smallCaps" }]),
        t(" caps", [{ type: "allCaps" }]),
        t(" sized", [{ type: "fontSize", attrs: { pt: 14 } }]),
      ],
    },
    {
      type: "table",
      attrs: { width: null },
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              attrs: {
                colspan: 2,
                rowspan: 1,
                colwidth: null,
                verticalAlign: "middle",
                borders: { top: "none", left: "thick" },
              },
              content: [p(t("wide"))],
            },
          ],
        },
        { type: "tableRow", content: [cell("tableCell", p(t("a"))), cell("tableCell", p(t("b")))] },
      ],
    },
  ],
};

describe("document preset", () => {
  const make = (doc: unknown) =>
    new Editor({
      extensions: documentExtensions({
        styles: DEFAULT_PARAGRAPH_STYLES,
        kind: "letter",
        isBlock: false,
        blocks: [],
      }),
      content: doc as never,
    });

  it.each([
    ["FULL_DOC", FULL_DOC],
    ["RICH_DOC", RICH_DOC],
  ])("%s: the editor JSON validates and comes back unchanged", (_name, doc) => {
    const editor = make(doc);
    const json = templateJSON(editor);
    const res = validateTemplateContent("letter", json);
    expect(res.ok).toBe(true);
    if (res.ok) expect(stripNulls(res.doc)).toEqual(stripNulls(json));
    // Non-null input values must reach the editor JSON (nothing lost on load).
    expect(stripNulls(json)).toEqual(stripNulls(doc));
    editor.destroy();
  });
});

describe("email preset", () => {
  it("real rendered template HTML keeps spacing, alignment and tables through editor and sanitizer", () => {
    const editor = new Editor({
      extensions: emailExtensions(),
      content: resolvedToHtml(renderFixture()),
    });
    const out = editor.getHTML().replace(/:\s+/g, ":");
    editor.destroy();
    // The DOM style parser may fold the margins into a shorthand.
    const spacing = /margin(-bottom)?:[^;"]*12pt/;
    expect(out).toMatch(spacing);
    expect(out).toContain("text-align:center");
    expect(out).toContain("text-align:right");
    expect(out).toContain("<table");
    expect(out).toContain("<th");
    expect(out).not.toContain("colgroup");
    // Whatever the DOM serialized (longhands or a folded shorthand), the
    // server keeps the spacing.
    const sent = sanitizeOutgoingEmailHtml(out);
    expect(sent).toMatch(/margin-bottom:12pt/);
    expect(sent).toContain("line-height:1.15");
    expect(sent).toContain("<table");
    expect(sent).toContain("text-align:center");
  });

  const make = (content: string) => new Editor({ extensions: emailExtensions(), content });
  const norm = (h: string) =>
    h
      .replace(/<br ?\/?>/g, "<br>")
      .replace(/;\s*"/g, '"')
      .replace(/:\s+/g, ":")
      .replace(/;\s+/g, ";");
  const stable = (html: string) => {
    const editor = make(html);
    const out = norm(editor.getHTML());
    editor.destroy();
    return { out, clean: norm(sanitizeOutgoingEmailHtml(out)) };
  };

  it("everything the editor can emit survives sanitizeOutgoingEmailHtml unchanged", () => {
    const { out, clean } = stable(
      [
        "<h2>H</h2><h3>S</h3>",
        "<p><strong>b</strong> <em>i</em> <s>s</s> <code>c</code> <u>u</u></p>",
        '<p style="text-align:center">c</p>',
        '<p style="margin-bottom:12pt;line-height:1.5">spaced</p>',
        '<p><span style="font-size:14pt">big</span></p>',
        '<p><a href="https://example.com/x">l</a> <a href="mailto:a@b.co">m</a></p>',
        "<blockquote><p>q</p></blockquote><ul><li><p>a</p></li></ul><ol><li><p>b</p></li></ol>",
        "<pre><code>x</code></pre>",
        '<table><tbody><tr><th style="text-align:right"><p>h</p></th><td colspan="2"><p>c</p></td></tr></tbody></table>',
      ].join(""),
    );
    expect(out).toContain("<table");
    expect(out).toContain('target="_blank"');
    expect(out).toContain("font-size:14pt");
    expect(out).toContain("text-align:center");
    expect(clean).toBe(out);
  });

  it("a pasted column width is not carried (the sanitizer would strip it)", () => {
    const { out, clean } = stable(
      '<table><tbody><tr><td colwidth="100" data-colwidth="100"><p>a</p></td></tr></tbody></table>',
    );
    expect(out).not.toContain("colwidth");
    expect(clean).toBe(out);
  });

  it("pasted paragraph style keeps only allowed declarations", () => {
    const editor = make('<p style="margin-bottom:12pt;color:red;position:absolute">x</p>');
    const html = norm(editor.getHTML());
    expect(html).toContain("margin-bottom:12pt");
    expect(html).not.toContain("color");
    expect(html).not.toContain("position");
    editor.destroy();
  });

  it("out-of-bounds values are dropped like the server does", () => {
    const editor = make('<p style="font-size:999pt;margin-left:-5pt;line-height:2">x</p>');
    const html = norm(editor.getHTML());
    expect(html).not.toContain("font-size");
    expect(html).not.toContain("margin-left");
    expect(html).toContain("line-height:2");
    editor.destroy();
  });

  it("refuses javascript:, data: and relative links", () => {
    const editor = make("<p>text</p>");
    editor.commands.selectAll();
    for (const href of [
      "javascript:alert(1)",
      "data:text/html,x",
      "/relative",
      "ftp://x.example/f",
    ]) {
      editor.commands.setLink({ href });
      expect(editor.getHTML()).not.toContain("<a");
    }
    editor.commands.setLink({ href: "https://example.com" });
    expect(editor.getHTML()).toContain('href="https://example.com"');
    editor.destroy();
  });

  it("drops a javascript: link on parse", () => {
    expect(make('<p><a href="javascript:alert(1)">x</a></p>').getHTML()).not.toContain(
      "javascript",
    );
  });

  it("TextAlign applies to paragraphs only", () => {
    const editor = make("<h2>h</h2>");
    editor.commands.setTextAlign("center");
    expect(editor.getHTML()).not.toContain("text-align");
    editor.destroy();
  });

  it("template-style HTML loads and re-serialises with its styles intact", () => {
    const html =
      '<p style="margin-top:6pt;margin-bottom:12pt;text-indent:36pt;text-align:justify">' +
      '<span style="font-size:11pt;text-transform:uppercase">Dear</span> Sir</p>';
    const { out, clean } = stable(html);
    for (const frag of [
      "margin-top:6pt",
      "text-indent:36pt",
      "text-align:justify",
      "font-size:11pt",
      "text-transform:uppercase",
    ])
      expect(out).toContain(frag);
    expect(clean).toBe(out);
  });

  it("nested styled spans keep every style", () => {
    const { out, clean } = stable(
      '<p><span style="font-size:11pt"><span style="text-transform:uppercase">A</span></span></p>',
    );
    expect(out).toContain("font-size:11pt");
    expect(out).toContain("text-transform:uppercase");
    expect(clean).toBe(out);
  });

  it("template output with size and caps on one span survives", () => {
    const { out, clean } = stable(
      '<p><span style="font-size:11pt;text-transform:uppercase"><strong>A</strong></span></p>',
    );
    expect(out).toContain("font-size:11pt");
    expect(out).toContain("text-transform:uppercase");
    expect(clean).toBe(out);
  });
});
