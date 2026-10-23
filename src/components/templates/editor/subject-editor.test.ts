// @vitest-environment happy-dom
/** Pasting several paragraphs into the subject flattens to one line. */
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import { validateSubject } from "@/lib/templates/schema";
import { DEFAULT_PARAGRAPH_STYLES } from "@/lib/templates/page-style";
import { createTemplateExtensions } from "./extensions";
import { flattenPasted } from "./subject-editor";

describe("flattenPasted", () => {
  it("joins paragraphs and line breaks with spaces, keeping field chips", () => {
    const editor = new Editor({
      extensions: createTemplateExtensions({
        styles: DEFAULT_PARAGRAPH_STYLES,
        kind: "sms",
        blocks: [],
      }),
    });
    const { schema } = editor;
    const p = (...c: Parameters<typeof schema.text>[0][]) =>
      schema.nodes.paragraph.create(
        null,
        c.map((t) => schema.text(t)),
      );
    const slice = new Slice(
      Fragment.from([
        p("Re: claim"),
        schema.nodes.paragraph.create(null, [
          schema.text("for "),
          schema.nodes.field.create({ path: "client.name", format: null }),
          schema.nodes.hardBreak.create(),
          schema.text("today"),
        ]),
      ]),
      1,
      1,
    );
    const flat = flattenPasted(slice, schema);
    expect(flat.content.childCount).toBe(1);
    expect(flat.content.firstChild!.textContent).toBe("Re: claim for  today");
    editor.commands.setContent({ type: "doc", content: [flat.content.firstChild!.toJSON()] });
    expect(validateSubject(editor.getJSON()).ok).toBe(true);
    expect(JSON.stringify(editor.getJSON())).toContain('"path":"client.name"');
    editor.destroy();
  });

  it("leaves a single-line paste alone", () => {
    const editor = new Editor({
      extensions: createTemplateExtensions({
        styles: DEFAULT_PARAGRAPH_STYLES,
        kind: "sms",
        blocks: [],
      }),
    });
    const slice = new Slice(
      Fragment.from(editor.schema.nodes.paragraph.create(null, editor.schema.text("x"))),
      1,
      1,
    );
    expect(flattenPasted(slice, editor.schema)).toBe(slice);
    editor.destroy();
  });
});
