/**
 * Splitting a table grid into nested rows and columns. No imports, so
 * the content schema can use it to refuse merges the PDF can't draw.
 */

/** A rectangle of grid positions. */
export type Box = { row: number; col: number; rowSpan: number; span: number };

type SpanAttrs = { attrs?: { colspan?: number; rowspan?: number } | null };

/** `placeCells` for table rows as stored (cells' colspan/rowspan attrs). */
export const placeTableCells = (rows: { content: SpanAttrs[] }[]) =>
  placeCells(
    rows.map((r) =>
      r.content.map((c) => ({ span: c.attrs?.colspan ?? 1, rowSpan: c.attrs?.rowspan ?? 1 })),
    ),
  );

/**
 * Places each row's cells on the grid, skipping positions a cell from
 * an earlier row still covers (HTML's table rule). Row spans past the
 * last row are cut back. Returns one box per cell, row by row in
 * source order, and the grid's size.
 */
export function placeCells(rows: { span: number; rowSpan: number }[][]): {
  boxes: Box[][];
  height: number;
  width: number;
} {
  const height = rows.length;
  const taken: boolean[][] = Array.from({ length: height }, () => []);
  const boxes = rows.map((cells, row) => {
    let col = 0;
    return cells.map(({ span, rowSpan }) => {
      while (taken[row][col]) col++;
      const box = { row, col, span, rowSpan: Math.min(rowSpan, height - row) };
      for (let r = row; r < row + box.rowSpan; r++) {
        for (let c = col; c < col + span; c++) taken[r][c] = true;
      }
      col += span;
      return box;
    });
  });
  return { boxes, height, width: Math.max(1, ...taken.map((r) => r.length)) };
}

/**
 * How the PDF lays a table out: cut it along a full row line no cell
 * crosses (giving stacked bands, which may break across pages), else a
 * full column line (side-by-side pieces that stretch to one height),
 * and repeat until each piece is one cell or an empty hole. Null when
 * some piece has no clean cut (cells interlocking like a pinwheel).
 */
export type Layout<T extends Box> =
  | { kind: "cell"; box: T }
  | { kind: "empty"; box: Box }
  | { kind: "rows" | "cols"; box: Box; children: Layout<T>[] };

export function splitLayout<T extends Box>(
  boxes: T[],
  height: number,
  width: number,
): Layout<T> | null {
  const go = (region: Box, inside: T[]): Layout<T> | null => {
    if (inside.length === 0) return { kind: "empty", box: region };
    const only = inside[0];
    if (inside.length === 1 && only.rowSpan === region.rowSpan && only.span === region.span) {
      return { kind: "cell", box: only };
    }
    for (const kind of ["rows", "cols"] as const) {
      const lo = kind === "rows" ? region.row : region.col;
      const hi = lo + (kind === "rows" ? region.rowSpan : region.span);
      const start = (b: Box) => (kind === "rows" ? b.row : b.col);
      const size = (b: Box) => (kind === "rows" ? b.rowSpan : b.span);
      const bounds = [lo];
      for (let k = lo + 1; k < hi; k++) {
        if (!inside.some((b) => start(b) < k && k < start(b) + size(b))) bounds.push(k);
      }
      if (bounds.length === 1) continue;
      bounds.push(hi);
      const children: Layout<T>[] = [];
      for (let i = 0; i < bounds.length - 1; i++) {
        const [a, b] = [bounds[i], bounds[i + 1]];
        const sub: Box =
          kind === "rows"
            ? { row: a, rowSpan: b - a, col: region.col, span: region.span }
            : { row: region.row, rowSpan: region.rowSpan, col: a, span: b - a };
        const child = go(
          sub,
          inside.filter((x) => start(x) >= a && start(x) + size(x) <= b),
        );
        if (!child) return null;
        children.push(child);
      }
      return { kind, box: region, children };
    }
    return null;
  };
  return go({ row: 0, col: 0, rowSpan: height, span: width }, boxes);
}
