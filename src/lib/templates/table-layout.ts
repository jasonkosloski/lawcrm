/**
 * Table geometry shared by the Word, PDF and HTML converters: the cell
 * grid (cells may span rows and columns), column widths, borders, and
 * the nested row/column split the PDF draws from.
 *
 * Word and the preview's collapsed CSS resolve each shared edge segment
 * themselves (the heavier rule wins), so they take a cell's `declared`
 * sides. The PDF draws each edge once from one cell, so it takes the
 * `borders` resolved here with the same rule; where one cell meets
 * several across an edge that is one weight across the whole side.
 */

import type { ResolvedTable, ResolvedTableCell } from "./render";
import { CELL_SIDES, type BorderWeight, type CellSide, type VerticalAlign } from "./schema";
import { placeTableCells, type Box } from "./table-split";

export { splitLayout, type Box, type Layout } from "./table-split";

/** The data attributes that carry non-thin sides in editor and preview HTML. */
export const CELL_SIDE_ATTR: Record<CellSide, string> = {
  top: "data-bt",
  right: "data-br",
  bottom: "data-bb",
  left: "data-bl",
};

type Sides = Record<CellSide, BorderWeight>;

export type GridCell = Box & {
  cell: ResolvedTableCell;
  /** The cell's own sides, as the editor set them. */
  declared: Sides;
  /** Each side after the shared-edge rule. */
  borders: Sides;
};

/** `rows` holds each row's cells left to right (a row-spanning cell
 *  appears once, in its first row; holes in a ragged row get an empty
 *  filler cell); `owner` maps every position to the cell covering it. */
export type TableGrid = {
  rows: GridCell[][];
  cols: number;
  height: number;
  owner: GridCell[][];
};

/** Rule widths in points; the preview scales these to pixels. */
export const BORDER_PT: Record<BorderWeight, number> = { none: 0, thin: 0.5, thick: 1.5 };

const RANK: Record<BorderWeight, number> = { none: 0, thin: 1, thick: 2 };
const heavier = (a: BorderWeight, b: BorderWeight) => (RANK[b] > RANK[a] ? b : a);
const OPPOSITE: Record<CellSide, CellSide> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

const own = (c: ResolvedTableCell): Sides =>
  Object.fromEntries(CELL_SIDES.map((s) => [s, c.attrs?.borders?.[s] ?? "thin"])) as Sides;

export const verticalAlignOf = (c: ResolvedTableCell): VerticalAlign =>
  c.attrs?.verticalAlign ?? "top";

/** Stands in for a missing position in a ragged row, so every output
 *  draws a complete grid (an empty, thin-ruled cell, as Word would). */
const FILLER: ResolvedTableCell = { type: "tableCell", content: [{ type: "paragraph" }] };

export function tableGrid(t: ResolvedTable): TableGrid {
  const placed = placeTableCells(t.content);
  const { height, width: cols } = placed;
  const owner: GridCell[][] = Array.from({ length: height }, () => []);
  const make = (box: Box, cell: ResolvedTableCell): GridCell => {
    const declared = own(cell);
    const g: GridCell = { ...box, cell, declared, borders: { ...declared } };
    for (let row = g.row; row < g.row + g.rowSpan; row++) {
      for (let c = g.col; c < g.col + g.span; c++) owner[row][c] = g;
    }
    return g;
  };
  const rows: GridCell[][] = t.content.map((r, ri) =>
    r.content.map((cell, ci) => make(placed.boxes[ri][ci], cell)),
  );
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < cols; col++) {
      if (!owner[row][col]) rows[row].push(make({ row, col, rowSpan: 1, span: 1 }, FILLER));
    }
    rows[row].sort((x, y) => x.col - y.col);
  }

  // The cells across each side: one per grid position along it.
  const across = (g: GridCell, side: CellSide): (GridCell | undefined)[] => {
    const out: (GridCell | undefined)[] = [];
    if (side === "top" || side === "bottom") {
      const r = side === "top" ? g.row - 1 : g.row + g.rowSpan;
      for (let c = g.col; c < g.col + g.span; c++) out.push(owner[r]?.[c]);
    } else {
      const c = side === "left" ? g.col - 1 : g.col + g.span;
      for (let r = g.row; r < g.row + g.rowSpan; r++) out.push(owner[r]?.[c]);
    }
    return out;
  };
  for (const g of rows.flat()) {
    for (const side of CELL_SIDES) {
      for (const o of across(g, side)) {
        if (o) g.borders[side] = heavier(g.borders[side], o.declared[OPPOSITE[side]]);
      }
    }
  }
  return { rows, cols, height, owner };
}

/** Editor-set widths per column, in editor pixels; null where unset. */
export function columnPx(grid: TableGrid): (number | null)[] {
  const out: (number | null)[] = Array(grid.cols).fill(null);
  for (const r of grid.rows) {
    for (const g of r) {
      const w = g.cell.attrs?.colwidth;
      if (!w) continue;
      w.forEach((px, j) => {
        if (px > 0 && out[g.col + j] === null) out[g.col + j] = px;
      });
    }
  }
  return out;
}

/** Editor pixels are CSS pixels, placed at 96 to the inch. */
export const EDITOR_PX_PER_IN = 96;

/** Each column's share of a full-width table (sums to 1). Unset columns
 *  take the average set width, so a table with no widths is even. */
export const columnFractions = (grid: TableGrid): number[] => columnShares(columnPx(grid));

/** `columnFractions` from per-column widths (null where unset); the
 *  editor uses it to show and set widths as the outputs will draw them. */
export function columnShares(px: (number | null)[]): number[] {
  const set = px.filter((w): w is number => w !== null);
  const fill = set.length ? set.reduce((a, b) => a + b, 0) / set.length : 1;
  const widths = px.map((w) => w ?? fill);
  const total = widths.reduce((a, b) => a + b, 0);
  return widths.map((w) => w / total);
}

/**
 * Column widths for a fit-to-content table: a set width wins (scaled
 * by `pxToUnit`), otherwise the widest single-column cell's content
 * (`natural`, which includes padding). Shrunk proportionally when the
 * total would pass `max`.
 */
export function fitColumnWidths(
  grid: TableGrid,
  natural: (cell: ResolvedTableCell) => number,
  pxToUnit: number,
  max: number,
): number[] {
  const px = columnPx(grid);
  const widths = px.map((w) => (w === null ? 0 : w * pxToUnit));
  for (const r of grid.rows) {
    for (const g of r) {
      if (g.span !== 1 || px[g.col] !== null) continue;
      widths[g.col] = Math.max(widths[g.col], natural(g.cell));
    }
  }
  // A merged cell wider than its columns widens them evenly.
  for (const r of grid.rows) {
    for (const g of r) {
      if (g.span === 1) continue;
      const cur = widths.slice(g.col, g.col + g.span).reduce((a, b) => a + b, 0);
      const need = natural(g.cell) - cur;
      if (need > 0) for (let j = 0; j < g.span; j++) widths[g.col + j] += need / g.span;
    }
  }
  const total = widths.reduce((a, b) => a + b, 0);
  return total > max ? widths.map((w) => (w * max) / total) : widths;
}

/** Sum of the widths a cell (or any box) spans. */
export const spannedWidth = (g: Box, widths: number[]) =>
  widths.slice(g.col, g.col + g.span).reduce((a, b) => a + b, 0);
