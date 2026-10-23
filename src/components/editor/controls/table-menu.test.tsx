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
import { createTemplateExtensions } from "@/components/templates/editor/extensions";
import { Toolbar } from "@/components/templates/editor/toolbar";
import { emailExtensions } from "@/components/editor/presets";
import userEvent from "@testing-library/user-event";
import { TableMenu } from "./table-menu";

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
      styles={DEFAULT_PARAGRAPH_STYLES}
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

describe("TableMenu features", () => {
  function menu(features?: Parameters<typeof TableMenu>[0]["features"]) {
    const editor = new Editor({
      extensions: createTemplateExtensions({
        styles: DEFAULT_PARAGRAPH_STYLES,
        kind: "filing",
        isBlock: false,
        blocks: [],
      }),
      content: { type: "doc", content: [{ type: "paragraph" }] } as never,
    });
    render(<TableMenu editor={editor} features={features} />);
  }

  it("shows every control by default", () => {
    menu();
    expect(screen.getByRole("button", { name: /^Borders/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Align top" })).toBeInTheDocument();
  });

  it("with every optional feature off, drops borders and vertical alignment", () => {
    menu({ merge: false, borders: false, width: false, valign: false });
    expect(screen.getByRole("button", { name: /^Table/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Borders/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Align top" })).toBeNull();
  });
});

describe("TableMenu hint", () => {
  it("lists only the features the surface has", async () => {
    const editor = new Editor({ extensions: emailExtensions(), content: "<p>x</p>" });
    const { unmount } = render(
      <TableMenu editor={editor} features={{ merge: false, borders: false, width: false }} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^Table/ }));
    expect(await screen.findByText("Click in a table for rows and columns.")).toBeInTheDocument();
    unmount();
    const full = new Editor({ extensions: emailExtensions(), content: "<p>x</p>" });
    render(<TableMenu editor={full} />);
    await userEvent.click(screen.getByRole("button", { name: /^Table/ }));
    expect(
      await screen.findByText("Click in a table for rows, columns, merging, and width."),
    ).toBeInTheDocument();
  });
});
