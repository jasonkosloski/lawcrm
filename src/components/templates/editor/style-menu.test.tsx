// @vitest-environment happy-dom
/** Style dropdown, All caps, size box and Clear formatting in the toolbar. */
import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Editor } from "@tiptap/react";
import type { TemplateData } from "@/lib/templates/catalog";
import { DEFAULT_PARAGRAPH_STYLES } from "@/lib/templates/page-style";
import { createTemplateExtensions } from "./extensions";
import { Toolbar } from "./toolbar";

function setup(content: unknown = { type: "doc", content: [{ type: "paragraph" }] }) {
  const editor = new Editor({
    extensions: createTemplateExtensions({
      styles: DEFAULT_PARAGRAPH_STYLES,
      kind: "filing",
      blocks: [],
    }),
    content: content as never,
  });
  render(
    <Toolbar
      editor={editor}
      fieldTarget={editor}
      kind="filing"
      fields={[]}
      lists={[]}
      data={{} as TemplateData}
      blocks={[]}
      styles={DEFAULT_PARAGRAPH_STYLES}
    />,
  );
  return editor;
}

const para = (text: string, attrs?: Record<string, unknown>) => ({
  type: "paragraph",
  attrs,
  content: [{ type: "text", text }],
});

describe("Style menu", () => {
  it("names the current style (Body by default) and shows no dot", () => {
    setup();
    expect(screen.getByRole("button", { name: "Style: Body" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Has direct formatting" })).toBeNull();
  });

  it("names a non-body style and shows a dot for direct settings", () => {
    setup({
      type: "doc",
      content: [para("x", { style: "caption", spaceAfterPt: 4 })],
    });
    expect(screen.getByRole("button", { name: "Style: Caption" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Has direct formatting" })).toBeInTheDocument();
  });

  it("picking Caption sets the style", async () => {
    const editor = setup({ type: "doc", content: [para("x")] });
    await userEvent.click(screen.getByRole("button", { name: /^Style:/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Caption" }));
    expect(editor.getJSON().content?.[0].attrs?.style).toBe("caption");
    expect(await screen.findByRole("button", { name: "Style: Caption" })).toBeInTheDocument();
  });

  it("applies to every selected paragraph", async () => {
    const editor = setup({ type: "doc", content: [para("a"), para("b")] });
    act(() => {
      editor.commands.selectAll();
    });
    await userEvent.click(screen.getByRole("button", { name: /^Style:/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Caption" }));
    const styles = editor.getJSON().content?.map((n) => n.attrs?.style);
    expect(styles).toEqual(["caption", "caption"]);
  });
});

describe("Text controls", () => {
  it("All caps toggles the mark", async () => {
    const editor = setup({ type: "doc", content: [para("hello")] });
    act(() => {
      editor.commands.selectAll();
    });
    await userEvent.click(screen.getByRole("button", { name: "All caps" }));
    expect(editor.isActive("allCaps")).toBe(true);
    expect(await screen.findByRole("button", { name: "All caps", pressed: true })).toBeVisible();
  });

  it("the size box sets and clears the font size", async () => {
    const editor = setup({ type: "doc", content: [para("hello")] });
    act(() => {
      editor.commands.selectAll();
    });
    const box = screen.getByRole("spinbutton", { name: "Font size" });
    await userEvent.type(box, "14{Enter}");
    expect(editor.getAttributes("fontSize").pt).toBe(14);
    await userEvent.clear(box);
    await userEvent.type(box, "{Enter}");
    expect(editor.isActive("fontSize")).toBe(false);
  });

  it("an out-of-range size is refused", async () => {
    const editor = setup({ type: "doc", content: [para("hello")] });
    act(() => {
      editor.commands.selectAll();
    });
    await userEvent.type(screen.getByRole("spinbutton", { name: "Font size" }), "200{Enter}");
    expect(editor.isActive("fontSize")).toBe(false);
  });

  it("Clear formatting removes marks, settings and alignment but keeps the style", async () => {
    const editor = setup({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { style: "caption", spaceAfterPt: 4, textAlign: "center" },
          content: [{ type: "text", text: "hi", marks: [{ type: "bold" }] }],
        },
      ],
    });
    act(() => {
      editor.commands.selectAll();
    });
    await userEvent.click(screen.getByRole("button", { name: "Clear formatting" }));
    const p = editor.getJSON().content?.[0];
    expect(p?.attrs?.spaceAfterPt ?? null).toBeNull();
    expect(p?.attrs?.textAlign ?? null).toBeNull();
    expect(p?.content?.[0].marks).toBeUndefined();
  });
});
