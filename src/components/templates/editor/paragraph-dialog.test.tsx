// @vitest-environment happy-dom
/** The Paragraph… popover: style values as placeholders, sparse writes, reset. */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Editor } from "@tiptap/react";
import { DEFAULT_PARAGRAPH_STYLES } from "@/lib/templates/page-style";
import { createTemplateExtensions } from "./extensions";
import { ParagraphDialog } from "./paragraph-dialog";

function setup(attrs?: Record<string, unknown>) {
  const editor = new Editor({
    extensions: createTemplateExtensions({
      styles: DEFAULT_PARAGRAPH_STYLES,
      kind: "filing",
      blocks: [],
    }),
    content: {
      type: "doc",
      content: [{ type: "paragraph", attrs, content: [{ type: "text", text: "x" }] }],
    } as never,
  });
  render(<ParagraphDialog editor={editor} styles={DEFAULT_PARAGRAPH_STYLES} />);
  return editor;
}

const open = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Paragraph…" }));
  return screen.findByLabelText("Space after (pt)");
};
const attrsOf = (e: Editor) => e.getJSON().content?.[0].attrs ?? {};

describe("ParagraphDialog", () => {
  it("shows the style's values as placeholders", async () => {
    setup();
    const body = DEFAULT_PARAGRAPH_STYLES.find((s) => s.key === "body")!.values;
    const after = await open();
    expect(after).toHaveAttribute("placeholder", String(body.spaceAfterPt));
    expect(after).toHaveValue(null);
  });

  it("applies only the changed field", async () => {
    const editor = setup();
    const after = await open();
    await userEvent.type(after, "9");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(attrsOf(editor).spaceAfterPt).toBe(9);
    expect(attrsOf(editor).spaceBeforePt ?? null).toBeNull();
    expect(attrsOf(editor).indentLeftIn ?? null).toBeNull();
  });

  it("reset removes an existing direct setting", async () => {
    const editor = setup({ spaceAfterPt: 9 });
    const after = await open();
    expect(after).toHaveValue(9);
    await userEvent.click(screen.getByRole("button", { name: "Reset Space after (pt)" }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(attrsOf(editor).spaceAfterPt ?? null).toBeNull();
  });

  it("refuses an out-of-range value", async () => {
    const editor = setup();
    const after = await open();
    await userEvent.type(after, "99");
    expect(screen.getByText("Spacing must be between 0 and 72 pt.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(attrsOf(editor).spaceAfterPt ?? null).toBeNull();
  });

  it("sets exact line spacing, hanging first line and a flag", async () => {
    const editor = setup();
    await open();
    await userEvent.selectOptions(screen.getByLabelText("Line spacing"), "exact");
    await userEvent.selectOptions(screen.getByLabelText("First line"), "hanging");
    await userEvent.selectOptions(screen.getByLabelText("Keep with next"), "yes");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(attrsOf(editor).lineSpacing).toEqual({ exactPt: 12 });
    expect(attrsOf(editor).firstLine).toEqual({ kind: "hanging", in: 0.5 });
    expect(attrsOf(editor).keepWithNext).toBe(true);
  });

  it("clearing the Exactly box never stores 0 pt", async () => {
    const editor = setup();
    await open();
    await userEvent.selectOptions(screen.getByLabelText("Line spacing"), "exact");
    const box = screen.getByLabelText("Exact line spacing (pt)");
    await userEvent.clear(box);
    expect(box).toHaveValue(null);
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(attrsOf(editor).lineSpacing).toEqual({ exactPt: 12 });
  });
});
