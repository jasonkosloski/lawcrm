import { describe, expect, it } from "vitest";
import { captionFixture } from "./converters-fixture";
import type { ResolvedTable, ResolvedTableCell } from "./render";
import type { TableCellNode } from "./schema";
import {
  columnFractions,
  fitColumnWidths,
  splitLayout,
  tableGrid,
  type Box,
  type Layout,
} from "./table-layout";

const c = (attrs?: TableCellNode["attrs"], text = "x"): ResolvedTableCell => ({
  type: "tableCell",
  ...(attrs ? { attrs } : {}),
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const t = (...rows: ResolvedTableCell[][]): ResolvedTable => ({
  type: "table",
  content: rows.map((content) => ({ type: "tableRow", content })),
});
const caption = () => captionFixture().content![0] as ResolvedTable;

describe("tableGrid", () => {
  it("places merged cells across the columns they span", () => {
    const g = tableGrid(caption());
    expect(g.cols).toBe(2);
    expect(g.rows[3]).toHaveLength(1);
    expect(g.rows[3][0]).toMatchObject({ col: 0, span: 2 });
    expect(g.rows[1][1]).toMatchObject({ col: 1, span: 1 });
  });

  it("defaults every side to thin", () => {
    const g = tableGrid(t([c()]));
    expect(g.rows[0][0].borders).toEqual({
      top: "thin",
      right: "thin",
      bottom: "thin",
      left: "thin",
    });
  });

  it("gives a shared edge the heavier of its two sides", () => {
    // Left cell says thick on its right; its neighbour says nothing.
    const g = tableGrid(t([c({ borders: { right: "thick" } }), c()]));
    expect(g.rows[0][1].borders.left).toBe("thick");
    // One side none, the other thin: the line still draws.
    const h = tableGrid(t([c({ borders: { bottom: "none" } })], [c()]));
    expect(h.rows[0][0].borders.bottom).toBe("thin");
    expect(h.rows[1][0].borders.top).toBe("thin");
  });

  it("keeps an edge off when both sides turn it off (the caption's stamp box)", () => {
    const g = tableGrid(caption());
    expect(g.rows[0][1].borders.bottom).toBe("none");
    expect(g.rows[1][1].borders.top).toBe("none");
    // The merged title row picks up the thick-free row above it per column.
    expect(g.rows[3][0].borders.top).toBe("thin");
    expect(g.rows[1][0].borders.bottom).toBe("thick");
    expect(g.rows[2][0].borders.top).toBe("thick");
  });
});

describe("columnFractions", () => {
  it("splits an unsized table evenly", () => {
    expect(columnFractions(tableGrid(t([c(), c(), c(), c()])))).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  it("keeps the editor's proportions", () => {
    const f = columnFractions(tableGrid(caption()));
    expect(f[0]).toBeCloseTo(2 / 3);
    expect(f[1]).toBeCloseTo(1 / 3);
  });

  it("gives unsized columns the average set width", () => {
    const f = columnFractions(tableGrid(t([c({ colwidth: [300] }), c(), c({ colwidth: [100] })])));
    expect(f).toEqual([0.5, 1 / 3, 1 / 6]);
  });
});

describe("fitColumnWidths", () => {
  const byText = (cell: ResolvedTableCell) => {
    const first = cell.content[0];
    const run = first.type === "paragraph" ? first.content?.[0] : undefined;
    return run && run.type === "text" ? run.text.length * 10 : 0;
  };

  it("sizes each column to its widest cell", () => {
    const g = tableGrid(t([c({}, "ab"), c({}, "abcdef")], [c({}, "abcd"), c({}, "a")]));
    expect(fitColumnWidths(g, byText, 1, 1000)).toEqual([40, 60]);
  });

  it("uses a set width instead of measuring", () => {
    const g = tableGrid(t([c({ colwidth: [100] }, "abcdefghijklmnop"), c({}, "ab")]));
    expect(fitColumnWidths(g, byText, 0.75, 1000)).toEqual([75, 20]);
  });

  it("widens columns under a merged cell that needs more room", () => {
    const g = tableGrid(t([c({}, "a"), c({}, "a")], [c({ colspan: 2 }, "abcdef")]));
    expect(fitColumnWidths(g, byText, 1, 1000)).toEqual([30, 30]);
  });

  it("shrinks proportionally to the text width", () => {
    const g = tableGrid(t([c({}, "a".repeat(30)), c({}, "a".repeat(10))]));
    expect(fitColumnWidths(g, byText, 1, 200)).toEqual([150, 50]);
  });
});

describe("row spans", () => {
  // Two rows: left cells separate, right side one merged cell.
  const merged = () =>
    t([c({}, "L1"), c({ rowspan: 2, borders: { left: "thick" } }, "R")], [c({}, "L2")]);

  it("places later rows' cells around a cell spanning down", () => {
    const g = tableGrid(merged());
    expect(g.height).toBe(2);
    expect(g.cols).toBe(2);
    expect(g.rows[1][0]).toMatchObject({ row: 1, col: 0 });
    expect(g.owner[1][1]).toBe(g.rows[0][1]);
  });

  it("resolves each side against every cell along it", () => {
    const g = tableGrid(merged());
    // Both left cells pick up the merged cell's thick left side.
    expect(g.rows[0][0].borders.right).toBe("thick");
    expect(g.rows[1][0].borders.right).toBe("thick");
    expect(g.rows[0][0].borders.bottom).toBe("thin");
  });

  it("fills holes in a ragged row with empty cells, in column order", () => {
    // Row 1 holds only D; C spans down into it at column 2, so column 1 is a hole.
    const g = tableGrid(t([c({}, "A"), c({}, "B"), c({ rowspan: 2 }, "C")], [c({}, "D")]));
    expect(g.rows[1].map((x) => x.col)).toEqual([0, 1]);
    expect(g.rows[1][1].cell.content).toEqual([{ type: "paragraph" }]);
    expect(g.owner[1][2]).toBe(g.rows[0][2]);
    // The filler gives C's left side a neighbour, so the rule is drawn.
    expect(g.rows[1][1].borders.right).toBe("thin");
  });

  it("cuts a span that runs past the last row", () => {
    const g = tableGrid(t([c({ rowspan: 5 })]));
    expect(g.rows[0][0].rowSpan).toBe(1);
  });
});

describe("splitLayout", () => {
  const box = (row: number, col: number, rowSpan = 1, span = 1): Box => ({
    row,
    col,
    rowSpan,
    span,
  });
  const shape = (l: Layout<Box> | null): unknown =>
    !l
      ? null
      : l.kind === "cell"
        ? `${l.box.row},${l.box.col}`
        : l.kind === "empty"
          ? "empty"
          : { [l.kind]: l.children.map(shape) };

  it("stacks plain rows into bands", () => {
    expect(shape(splitLayout([box(0, 0), box(0, 1), box(1, 0), box(1, 1)], 2, 2))).toEqual({
      rows: [{ cols: ["0,0", "0,1"] }, { cols: ["1,0", "1,1"] }],
    });
  });

  it("puts a row-spanning cell beside the stack it spans", () => {
    expect(shape(splitLayout([box(0, 0), box(0, 1, 2), box(1, 0)], 2, 2))).toEqual({
      cols: [{ rows: ["0,0", "1,0"] }, "0,1"],
    });
  });

  it("keeps rows no span crosses as separate bands (page breaks fall between them)", () => {
    const l = splitLayout([box(0, 0), box(0, 1, 2), box(1, 0), box(2, 0, 1, 2)], 3, 2);
    expect(shape(l)).toEqual({
      rows: [{ cols: [{ rows: ["0,0", "1,0"] }, "0,1"] }, "2,0"],
    });
  });

  it("fills holes in a ragged table", () => {
    expect(shape(splitLayout([box(0, 0), box(0, 1), box(1, 0)], 2, 2))).toEqual({
      rows: [{ cols: ["0,0", "0,1"] }, { cols: ["1,0", "empty"] }],
    });
  });

  it("returns null for a pinwheel", () => {
    const pinwheel = [
      box(0, 0, 1, 2),
      box(0, 2, 2, 1),
      box(1, 1),
      box(2, 1, 1, 2),
      box(1, 0, 2, 1),
    ];
    expect(splitLayout(pinwheel, 3, 3)).toBeNull();
  });
});
