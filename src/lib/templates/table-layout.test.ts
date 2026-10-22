import { describe, expect, it } from "vitest";
import { captionFixture } from "./converters-fixture";
import type { ResolvedTable, ResolvedTableCell } from "./render";
import type { TableCellNode } from "./schema";
import { columnFractions, fitColumnWidths, tableGrid } from "./table-layout";

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
