/**
 * Tests for the shared Tiptap editor.
 *
 * Regressions pinned:
 *   - the `placeholder` prop never rendered (data-placeholder had no
 *     reader)
 *   - toolbar aria-pressed/active state went stale: Tiptap 3 doesn't
 *     re-render on transactions, so clicking Bold with an empty
 *     selection (a stored mark) left the button un-pressed
 *   - StarterKit's `---` input rule produced <hr>, which the note
 *     sanitizer strips on save; the editor and sanitizer must agree
 */

import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Editor } from "@tiptap/core";
import { RichTextEditor, createEditorExtensions } from "./rich-text-editor";
import { sanitizeUserHtml } from "@/lib/sanitize-html";

describe("RichTextEditor — placeholder", () => {
  test("shows the placeholder while empty", async () => {
    render(<RichTextEditor onChange={() => {}} placeholder="Write your reply…" />);
    expect(await screen.findByText("Write your reply…")).toBeInTheDocument();
  });

  test("hides the placeholder once there is content", async () => {
    render(
      <RichTextEditor
        onChange={() => {}}
        initialHTML="<p>Already typed</p>"
        placeholder="Write your reply…"
      />,
    );
    await screen.findByRole("button", { name: "Bold" });
    expect(screen.queryByText("Write your reply…")).toBeNull();
  });
});

describe("RichTextEditor — toolbar state", () => {
  test("clicking Bold with an empty selection updates aria-pressed without a document change", async () => {
    const user = userEvent.setup();
    render(<RichTextEditor onChange={() => {}} />);
    const bold = await screen.findByRole("button", { name: "Bold" });
    expect(bold).toHaveAttribute("aria-pressed", "false");

    await user.click(bold);
    expect(bold).toHaveAttribute("aria-pressed", "true");

    await user.click(bold);
    expect(bold).toHaveAttribute("aria-pressed", "false");
  });
});

describe("editor extensions stay in lockstep with the sanitizer", () => {
  const make = (content: string) => new Editor({ extensions: createEditorExtensions(), content });

  test("horizontal rule is not part of the schema (a typed --- can't emit <hr>)", () => {
    const editor = make("<p>a</p>");
    expect(editor.schema.nodes.horizontalRule).toBeUndefined();
    // A pasted <hr> is dropped by the schema rather than kept.
    expect(make("<p>a</p><hr><p>b</p>").getHTML()).not.toContain("<hr");
    editor.destroy();
  });

  test("everything the editor can emit survives sanitizeUserHtml unchanged", () => {
    const editor = make(
      [
        "<h2>Heading</h2>",
        "<h3>Sub</h3>",
        "<p><strong>b</strong> <em>i</em> <s>s</s> <code>c</code></p>",
        "<blockquote><p>q</p></blockquote>",
        "<ul><li><p>one</p></li></ul>",
        "<ol><li><p>two</p></li></ol>",
        "<pre><code>block</code></pre>",
      ].join(""),
    );
    const html = editor.getHTML();
    expect(html).toContain("<h2>");
    expect(html).toContain("<blockquote>");
    expect(sanitizeUserHtml(html)).toBe(html);
    editor.destroy();
  });
});
