// @vitest-environment happy-dom
/**
 * Table commands: borders stay in step across shared edges, merging is
 * row-only, width toggles, and every result is content the schema keeps.
 */
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { CellSelection } from "@tiptap/pm/tables";
import { validateTemplateContent } from "@/lib/templates/schema";
import { createTemplateExtensions, templateJSON } from "./extensions";
import {
  bordersAre,
  canMergeInRow,
  fillColumnWidths,
  setBorders,
  setTableWidth,
  tableWidthAt,
  type BorderTarget,
  type Weight,
} from "./table-commands";

type Cell = { type: string; attrs: Record<string, unknown>; content?: unknown[] };
type Json = {
  content: { type: string; attrs?: Record<string, unknown>; content: { content: Cell[] }[] }[];
};

function grid(rows = 2, cols = 2) {
  const editor = new Editor({
    extensions: createTemplateExtensions({ kind: "filing", isBlock: false, blocks: [] }),
    content: { type: "doc", content: [{ type: "paragraph" }] } as never,
  });
  editor.commands.insertTable({ rows, cols, withHeaderRow: false });
  return editor;
}

/** Cell start positions in reading order. */
function cellPositions(editor: Editor): number[] {
  const out: number[] = [];
  editor.state.doc.descendants((n, pos) => {
    if (n.type.name === "tableCell") out.push(pos);
  });
  return out;
}

/** Put the cursor in cell `i`, or select cells `i`..`j`. */
function select(editor: Editor, i: number, j?: number) {
  const cells = cellPositions(editor);
  if (j === undefined) {
    editor.commands.setTextSelection(cells[i] + 2);
  } else {
    const doc = editor.state.doc;
    editor.view.dispatch(
      editor.state.tr.setSelection(CellSelection.create(doc, cells[i], cells[j])),
    );
  }
}

const run = (editor: Editor, target: BorderTarget, weight: Weight = "thin") => {
  const tr = setBorders(editor.state, target, weight);
  if (tr) editor.view.dispatch(tr);
};

const cells = (editor: Editor): Cell[] =>
  (templateJSON(editor) as unknown as Json).content
    .find((b) => b.type === "table")!
    .content.flatMap((r) => r.content);
const borders = (editor: Editor) => cells(editor).map((c) => c.attrs.borders ?? null);

describe("setBorders", () => {
  it("turns a side off on both cells that share it, and back on", () => {
    const e = grid();
    select(e, 0); // top-left
    run(e, "right");
    // Already thin, so the side button removes it from cell 0 and cell 1.
    expect(borders(e)).toEqual([{ right: "none" }, { left: "none" }, null, null]);
    run(e, "right");
    expect(borders(e)).toEqual([null, null, null, null]);
  });

  it("draws a thick side, and a second press removes it", () => {
    const e = grid();
    select(e, 0);
    run(e, "bottom", "thick");
    expect(borders(e)).toEqual([{ bottom: "thick" }, null, { top: "thick" }, null]);
    expect(bordersAre(e.state, "bottom", "thick")).toBe(true);
    run(e, "bottom", "thick");
    expect(borders(e)).toEqual([{ bottom: "none" }, null, { top: "none" }, null]);
  });

  it("presets cover the selection: none, outer, inner, all", () => {
    const e = grid(3, 3);
    select(e, 0, 4); // top-left 2x2 block
    run(e, "none");
    const after = borders(e);
    expect(after[0]).toEqual({ top: "none", right: "none", bottom: "none", left: "none" });
    // Cells outside the block lose only the side they share with it.
    expect(after[2]).toEqual({ left: "none" });
    expect(after[6]).toEqual({ top: "none" });
    expect(after[8]).toBeNull();

    run(e, "outer", "thick");
    const outer = borders(e);
    expect(outer[0]).toEqual({ top: "thick", right: "none", bottom: "none", left: "thick" });
    expect(outer[2]).toEqual({ left: "thick" });

    run(e, "inner");
    expect(borders(e)[0]).toEqual({ top: "thick", left: "thick" });

    run(e, "all");
    expect(borders(e).slice(0, 2)).toEqual([null, null]);
  });

  it("does nothing outside a table", () => {
    const e = new Editor({
      extensions: createTemplateExtensions({ kind: "letter", isBlock: false, blocks: [] }),
      content: { type: "doc", content: [{ type: "paragraph" }] } as never,
    });
    expect(setBorders(e.state, "all", "thin")).toBeNull();
    expect(tableWidthAt(e.state)).toBeNull();
  });
});

describe("merging", () => {
  it("allows merging across one row only", () => {
    const e = grid(2, 3);
    select(e, 0, 1);
    expect(canMergeInRow(e.state)).toBe(true);
    select(e, 0, 3); // down a column
    expect(canMergeInRow(e.state)).toBe(false);
    select(e, 0);
    expect(canMergeInRow(e.state)).toBe(false);
  });

  it("produces a colspan the schema accepts, and border edits skip the merged interior", () => {
    const e = grid(2, 3);
    select(e, 0, 1);
    e.commands.mergeCells();
    expect(cells(e)[0].attrs.colspan).toBe(2);
    select(e, 0);
    run(e, "inner");
    expect(validateTemplateContent("filing", templateJSON(e)).ok).toBe(true);
  });
});

describe("width and alignment", () => {
  it("toggles fit and full", () => {
    const e = grid();
    select(e, 0);
    expect(tableWidthAt(e.state)).toBe("full");
    e.view.dispatch(setTableWidth(e.state, "fit")!);
    expect(tableWidthAt(e.state)).toBe("fit");
    const v = validateTemplateContent("filing", templateJSON(e));
    expect(v.ok && v.doc.content![0]).toMatchObject({ attrs: { width: "fit" } });
    e.view.dispatch(setTableWidth(e.state, "full")!);
    expect(tableWidthAt(e.state)).toBe("full");
  });

  it("sets vertical alignment and horizontal alignment on every selected cell", () => {
    const e = grid();
    select(e, 0, 3);
    e.commands.setCellAttribute("verticalAlign", "bottom");
    e.commands.setTextAlign("center");
    for (const c of cells(e)) {
      expect(c.attrs.verticalAlign).toBe("bottom");
      expect((c.content![0] as Cell).attrs.textAlign).toBe("center");
    }
  });

  it("round trips every table setting through JSON and HTML", () => {
    const e = grid();
    select(e, 0);
    run(e, "bottom", "thick");
    e.commands.setCellAttribute("verticalAlign", "middle");
    e.view.dispatch(setTableWidth(e.state, "fit")!);
    const json = templateJSON(e);
    expect(validateTemplateContent("filing", json).ok).toBe(true);

    const fromHtml = new Editor({
      extensions: createTemplateExtensions({ kind: "filing", isBlock: false, blocks: [] }),
      content: e.getHTML(),
    });
    expect(templateJSON(fromHtml)).toEqual(json);
  });
});

describe("fillColumnWidths", () => {
  const setWidth = (e: Editor, i: number, px: number) => {
    const pos = cellPositions(e)[i];
    const node = e.state.doc.nodeAt(pos)!;
    e.view.dispatch(e.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, colwidth: [px] }));
  };
  const widths = (e: Editor) => cells(e).map((c) => c.attrs.colwidth);

  it("records the measured width of unsized columns once one is set", () => {
    const e = grid(2, 3);
    // ProseMirror copies the width down the column; happy-dom measures 0,
    // so the plugin hasn't filled the others yet.
    setWidth(e, 0, 450);
    expect(widths(e)).toEqual([[450], null, null, [450], null, null]);
    const tr = fillColumnWidths(e.state, () => 125.4);
    e.view.dispatch(tr!);
    expect(widths(e)).toEqual([[450], [125], [125], [450], [125], [125]]);
    expect(tr!.getMeta("addToHistory")).toBe(false);
  });

  it("leaves tables with no widths, or all of them, alone", () => {
    const e = grid(1, 2);
    expect(fillColumnWidths(e.state, () => 100)).toBeNull();
    setWidth(e, 0, 100);
    setWidth(e, 1, 200);
    expect(fillColumnWidths(e.state, () => 100)).toBeNull();
  });

  it("waits when a column can't be measured", () => {
    const e = grid(1, 2);
    setWidth(e, 0, 300);
    expect(fillColumnWidths(e.state, () => null)).toBeNull();
  });

  it("writes one width per spanned column on a merged cell", () => {
    const e = grid(2, 2);
    select(e, 2, 3);
    e.commands.mergeCells();
    setWidth(e, 0, 300);
    e.view.dispatch(fillColumnWidths(e.state, () => 150)!);
    expect(widths(e)).toEqual([[300], [150], [300, 150]]);
  });
});
