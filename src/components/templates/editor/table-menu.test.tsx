// @vitest-environment happy-dom
/**
 * The table controls are always in the toolbar (so they can be found),
 * greyed out until the cursor is in a table.
 */
import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/react";
import type { TemplateData } from "@/lib/templates/catalog";
import { DEFAULT_PARAGRAPH_STYLES } from "@/lib/templates/page-style";
import { createTemplateExtensions } from "./extensions";
import { Toolbar } from "./toolbar";

function setup() {
  const editor = new Editor({
    extensions: createTemplateExtensions({
      styles: DEFAULT_PARAGRAPH_STYLES,
      kind: "filing",
      isBlock: false,
      blocks: [],
    }),
    content: { type: "doc", content: [{ type: "paragraph" }] } as never,
  });
  render(
    <Toolbar
      editor={editor}
      fieldTarget={editor}
      kind="filing"
      isBlock={false}
      fields={[]}
      lists={[]}
      data={{} as TemplateData}
      blocks={[]}
    />,
  );
  return editor;
}

describe("TableMenu", () => {
  it("shows the Table and Borders controls outside a table, borders and alignment disabled", () => {
    setup();
    expect(screen.getByRole("button", { name: /^Table/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^Borders/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Align bottom" })).toBeDisabled();
  });

  it("enables them once the cursor is in a table", async () => {
    const editor = setup();
    await act(async () => {
      editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: false });
    });
    expect(screen.getByRole("button", { name: /^Borders/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Align top" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await act(async () => {
      screen.getByRole("button", { name: "Align bottom" }).click();
    });
    expect(screen.getByRole("button", { name: "Align bottom" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
