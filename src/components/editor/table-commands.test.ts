// @vitest-environment happy-dom
/**
 * Table commands: borders stay in step across shared edges, merging is
 * refused only when the PDF couldn't lay it out, width toggles, and
 * every result is content the schema keeps.
 */
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { CellSelection, TableMap } from "@tiptap/pm/tables";
import { validateTemplateContent } from "@/lib/templates/schema";
import { DEFAULT_PARAGRAPH_STYLES } from "@/lib/templates/page-style";
import { createTemplateExtensions, templateJSON } from "@/components/templates/editor/extensions";
import {
  bordersAre,
  mergeCheck,
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
    extensions: createTemplateExtensions({
      styles: DEFAULT_PARAGRAPH_STYLES,
      kind: "filing",
      isBlock: false,
      blocks: [],
    }),
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
      extensions: createTemplateExtensions({
        styles: DEFAULT_PARAGRAPH_STYLES,
        kind: "letter",
        isBlock: false,
        blocks: [],
      }),
      content: { type: "doc", content: [{ type: "paragraph" }] } as never,
    });
    expect(setBorders(e.state, "all", "thin")).toBeNull();
    expect(tableWidthAt(e.state)).toBeNull();
  });
});

describe("merging", () => {
  /** Select grid positions (r0, c0) to (r1, c1), inclusive. */
  function selectRect(e: Editor, r0: number, c0: number, r1: number, c1: number) {
    let tablePos = -1;
    e.state.doc.descendants((n, pos) => {
      if (tablePos < 0 && n.type.name === "table") tablePos = pos;
    });
    const table = e.state.doc.nodeAt(tablePos)!;
    const map = TableMap.get(table);
    const at = (r: number, c: number) => tablePos + 1 + map.map[r * map.width + c];
    e.view.dispatch(
      e.state.tr.setSelection(CellSelection.create(e.state.doc, at(r0, c0), at(r1, c1))),
    );
  }

  it("merges down a column: two rows, left cells separate, right side one cell", () => {
    const e = grid(2, 2);
    selectRect(e, 0, 1, 1, 1);
    expect(mergeCheck(e.state)).toBe("ok");
    e.commands.mergeCells();
    const c = cells(e);
    expect(c).toHaveLength(3);
    expect(c[1].attrs.rowspan).toBe(2);
    expect(validateTemplateContent("filing", templateJSON(e)).ok).toBe(true);
  });

  it("merges a block across rows and columns", () => {
    const e = grid(3, 3);
    selectRect(e, 0, 0, 1, 1);
    expect(mergeCheck(e.state)).toBe("ok");
    e.commands.mergeCells();
    expect(cells(e)[0].attrs).toMatchObject({ colspan: 2, rowspan: 2 });
    expect(validateTemplateContent("filing", templateJSON(e)).ok).toBe(true);
  });

  it("needs more than one cell", () => {
    const e = grid(2, 2);
    select(e, 0);
    expect(mergeCheck(e.state)).toBe("unavailable");
    // Selecting one already-merged cell is still just one cell.
    selectRect(e, 0, 1, 1, 1);
    e.commands.mergeCells();
    selectRect(e, 0, 1, 1, 1);
    expect(mergeCheck(e.state)).toBe("unavailable");
  });

  it("refuses the merge that would make a pinwheel", () => {
    const e = grid(3, 3);
    selectRect(e, 0, 0, 0, 1); // top, across
    e.commands.mergeCells();
    selectRect(e, 0, 2, 1, 2); // right, down
    e.commands.mergeCells();
    selectRect(e, 2, 1, 2, 2); // bottom, across
    e.commands.mergeCells();
    selectRect(e, 1, 0, 2, 0); // left, down: closes the ring around the centre
    expect(mergeCheck(e.state)).toBe("interlock");
  });

  it("border edits skip the inside of a merged cell", () => {
    const e = grid(2, 2);
    selectRect(e, 0, 1, 1, 1);
    e.commands.mergeCells();
    selectRect(e, 0, 0, 1, 0);
    run(e, "none");
    // The merged cell loses only its left side, never a phantom top/bottom
    // between its own rows.
    expect(borders(e)[1]).toEqual({ left: "none" });
    expect(validateTemplateContent("filing", templateJSON(e)).ok).toBe(true);
  });

  it("produces a colspan the schema accepts", () => {
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
      extensions: createTemplateExtensions({
        styles: DEFAULT_PARAGRAPH_STYLES,
        kind: "filing",
        isBlock: false,
        blocks: [],
      }),
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
