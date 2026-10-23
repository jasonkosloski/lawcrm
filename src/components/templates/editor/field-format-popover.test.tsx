// @vitest-environment happy-dom
/** The field chip popover: the If missing option writes `ifMissing`. */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Editor } from "@tiptap/react";
import { DEFAULT_PARAGRAPH_STYLES } from "@/lib/templates/page-style";
import { createTemplateExtensions } from "./extensions";
import { FieldFormatPopover } from "./field-format-popover";
import { fieldChipText } from "./field-node";

function setup(attrs: Record<string, unknown>) {
  const editor = new Editor({
    extensions: createTemplateExtensions({
      styles: DEFAULT_PARAGRAPH_STYLES,
      kind: "letter",
      blocks: [],
    }),
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "field", attrs }] }],
    } as never,
  });
  render(<FieldFormatPopover editor={editor} pos={1} onClose={() => {}} />);
  return editor;
}

const fieldAttrs = (e: Editor) => e.state.doc.nodeAt(1)?.attrs ?? {};

describe("FieldFormatPopover", () => {
  it("defaults to Show as missing and switches to Leave blank and back", async () => {
    const editor = setup({ path: "client.name", format: null });
    const select = await screen.findByLabelText("If missing");
    expect(select).toHaveValue("show");
    await userEvent.selectOptions(select, "Leave blank");
    expect(fieldAttrs(editor)).toMatchObject({ ifMissing: "hide" });
    await userEvent.selectOptions(select, "Show as missing");
    expect(fieldAttrs(editor)).toMatchObject({ ifMissing: null });
  });

  it("reads a stored Leave blank", async () => {
    setup({ path: "client.name", format: null, ifMissing: "hide" });
    expect(await screen.findByLabelText("If missing")).toHaveValue("hide");
  });
});

describe("fieldChipText", () => {
  it("notes a blank-if-missing field after its format", () => {
    expect(fieldChipText("client.name", "last", null, "hide")).toBe(
      "Client name · Last name · blank if missing",
    );
    expect(fieldChipText("client.name", null, null, null)).toBe("Client name");
  });
});

describe("FieldFormatPopover on an unknown path", () => {
  it("offers no If missing option, since the renderer would show the path anyway", () => {
    setup({ path: "nope.nothing", format: null });
    expect(screen.queryByLabelText("If missing")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove field" })).toBeInTheDocument();
  });
});
