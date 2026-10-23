// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { createTemplateExtensions } from "@/components/templates/editor/extensions";
import { DEFAULT_PARAGRAPH_STYLES } from "@/lib/templates/page-style";
import { AlignButtons, ListButtons, MarkButtons } from ".";

function templateEditor() {
  const editor = new Editor({
    extensions: createTemplateExtensions({
      styles: DEFAULT_PARAGRAPH_STYLES,
      kind: "filing",
      isBlock: false,
      blocks: [],
    }),
    content: "<p>hello</p>",
  });
  editor.commands.selectAll();
  return editor;
}

describe("MarkButtons", () => {
  it("renders only the requested marks", () => {
    render(<MarkButtons editor={templateEditor()} marks={["bold", "smallCaps"]} />);
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Bold",
      "Small caps",
    ]);
  });

  it("toggles the mark and reflects aria-pressed", async () => {
    const editor = templateEditor();
    render(<MarkButtons editor={editor} marks={["bold", "allCaps"]} />);
    const bold = screen.getByRole("button", { name: "Bold" });
    expect(bold).toHaveAttribute("aria-pressed", "false");
    await act(async () => bold.click());
    expect(editor.isActive("bold")).toBe(true);
    expect(await screen.findByRole("button", { name: "Bold", pressed: true })).toBeTruthy();
    await act(async () => screen.getByRole("button", { name: "All caps" }).click());
    expect(editor.isActive("allCaps")).toBe(true);
  });

  it("supports the strike and code marks", async () => {
    const editor = new Editor({ extensions: [StarterKit], content: "<p>hello</p>" });
    editor.commands.selectAll();
    render(<MarkButtons editor={editor} marks={["strike", "code"]} />);
    await act(async () => screen.getByRole("button", { name: "Strikethrough" }).click());
    expect(editor.isActive("strike")).toBe(true);
    await act(async () => screen.getByRole("button", { name: "Inline code" }).click());
    expect(editor.isActive("code")).toBe(true);
  });
});

describe("ListButtons", () => {
  it("toggles lists and reflects aria-pressed", async () => {
    const editor = templateEditor();
    render(<ListButtons editor={editor} />);
    await act(async () => screen.getByRole("button", { name: "Bulleted list" }).click());
    expect(editor.isActive("bulletList")).toBe(true);
    expect(
      await screen.findByRole("button", { name: "Bulleted list", pressed: true }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Numbered list" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

describe("AlignButtons", () => {
  it("sets alignment and shows the pressed state", async () => {
    const editor = templateEditor();
    render(<AlignButtons editor={editor} />);
    await act(async () => screen.getByRole("button", { name: "Center" }).click());
    expect(editor.isActive({ textAlign: "center" })).toBe(true);
    expect(await screen.findByRole("button", { name: "Center", pressed: true })).toBeTruthy();
  });

  it("renders only the requested values", () => {
    render(<AlignButtons editor={templateEditor()} values={["left", "right"]} />);
    expect(screen.queryByRole("button", { name: "Center" })).toBeNull();
    expect(screen.getByRole("button", { name: "Align right" })).toBeTruthy();
  });
});
