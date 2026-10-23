// @vitest-environment happy-dom
/**
 * Preset parity: each editor preset must emit only what its server-side
 * gate (sanitizer / template schema) accepts, or content silently
 * disappears on save.
 */
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { sanitizeUserHtml } from "@/lib/sanitize-html";
import { validateTemplateContent } from "@/lib/templates/schema";
import { DEFAULT_PARAGRAPH_STYLES } from "@/lib/templates/page-style";
import { templateJSON } from "@/components/templates/editor/extensions";
import { FULL_DOC } from "@/components/templates/editor/test-fixtures";
import { documentExtensions, notesExtensions, type EditorPreset } from "./presets";

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

  it("link output keeps its href through the sanitizer (which adds rel hardening)", () => {
    const editor = make('<p><a href="https://example.com">l</a></p>');
    expect(sanitizeUserHtml(editor.getHTML())).toContain('href="https://example.com"');
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

describe("document preset", () => {
  it("templateJSON of a doc using every document node passes validateTemplateContent", () => {
    const editor = new Editor({
      extensions: documentExtensions({
        styles: DEFAULT_PARAGRAPH_STYLES,
        kind: "letter",
        isBlock: false,
        blocks: [],
      }),
      content: FULL_DOC as never,
    });
    const json = templateJSON(editor);
    expect(validateTemplateContent("letter", json).ok).toBe(true);
    expect(json.content?.length).toBe(FULL_DOC.content.length);
    editor.destroy();
  });
});

describe("EditorPreset", () => {
  it("names the three presets", () => {
    const all: EditorPreset[] = ["notes", "email", "document"];
    expect(all).toHaveLength(3);
  });
});
