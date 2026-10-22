/**
 * Table geometry shared by the Word, PDF and HTML converters: the cell
 * grid (cells merge across a row only), column widths, and borders.
 * Word and the preview's collapsed CSS resolve each shared edge segment
 * themselves (the heavier rule wins), so they take a cell's `declared`
 * sides. The PDF draws each edge once from one cell, so it takes the
 * `borders` resolved here with the same rule; where a merged cell sits
 * above split cells that is one weight across the whole merged cell.
 */

import type { ResolvedTable, ResolvedTableCell } from "./render";
import { CELL_SIDES, type BorderWeight, type CellSide, type VerticalAlign } from "./schema";

/** The data attributes that carry non-thin sides in editor and preview HTML. */
export const CELL_SIDE_ATTR: Record<CellSide, string> = {
  top: "data-bt",
  right: "data-br",
  bottom: "data-bb",
  left: "data-bl",
};

type Sides = Record<CellSide, BorderWeight>;

export type GridCell = {
  cell: ResolvedTableCell;
  row: number;
  /** First column the cell covers. */
  col: number;
  span: number;
  /** The cell's own sides, as the editor set them. */
  declared: Sides;
  /** Each side after the shared-edge rule. */
  borders: Sides;
};

export type TableGrid = { rows: GridCell[][]; cols: number };

/** Rule widths in points; the preview scales these to pixels. */
export const BORDER_PT: Record<BorderWeight, number> = { none: 0, thin: 0.5, thick: 1.5 };

const RANK: Record<BorderWeight, number> = { none: 0, thin: 1, thick: 2 };
const heavier = (a: BorderWeight, b: BorderWeight) => (RANK[b] > RANK[a] ? b : a);

const spanOf = (c: ResolvedTableCell) => c.attrs?.colspan ?? 1;
const own = (c: ResolvedTableCell): Sides =>
  Object.fromEntries(CELL_SIDES.map((s) => [s, c.attrs?.borders?.[s] ?? "thin"])) as Sides;

export const verticalAlignOf = (c: ResolvedTableCell): VerticalAlign =>
  c.attrs?.verticalAlign ?? "top";

export function tableGrid(t: ResolvedTable): TableGrid {
  const rows: GridCell[][] = t.content.map((r, row) => {
    let col = 0;
    return r.content.map((cell) => {
      const declared = own(cell);
      const g: GridCell = {
        cell,
        row,
        col,
        span: spanOf(cell),
        declared,
        borders: { ...declared },
      };
      col += g.span;
      return g;
    });
  });
  const cols = Math.max(1, ...rows.map((r) => r.reduce((n, g) => n + g.span, 0)));

  const overlaps = (a: GridCell, b: GridCell) => a.col < b.col + b.span && b.col < a.col + a.span;
  rows.forEach((r, ri) =>
    r.forEach((g, ci) => {
      const d = g.declared;
      if (ci > 0) g.borders.left = heavier(d.left, r[ci - 1].declared.right);
      if (ci < r.length - 1) g.borders.right = heavier(d.right, r[ci + 1].declared.left);
      for (const [other, mine, theirs] of [
        [ri - 1, "top", "bottom"],
        [ri + 1, "bottom", "top"],
      ] as const) {
        rows[other]?.forEach((o) => {
          if (overlaps(g, o)) g.borders[mine] = heavier(g.borders[mine], o.declared[theirs]);
        });
      }
    }),
  );
  return { rows, cols };
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

/** Each column's share of a full-width table (sums to 1). Unset columns
 *  take the average set width, so a table with no widths is even. */
export function columnFractions(grid: TableGrid): number[] {
  const px = columnPx(grid);
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

/** Sum of the widths a cell spans. */
export const spannedWidth = (g: GridCell, widths: number[]) =>
  widths.slice(g.col, g.col + g.span).reduce((a, b) => a + b, 0);
