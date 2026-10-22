/**
 * Table commands the template editor adds on top of TipTap's: width,
 * per-side borders and row-only merging. Borders apply to the selected
 * cells (or the cursor's cell) and keep a shared edge's two sides in
 * step, so turning off a line removes it from both neighbours.
 */

import type { EditorState, Transaction } from "@tiptap/pm/state";
import {
  CellSelection,
  isInTable,
  selectedRect,
  TableMap,
  type TableRect,
} from "@tiptap/pm/tables";
import type { CellBorders, CellSide } from "@/lib/templates/schema";

export type TableWidth = "full" | "fit";
/** Where a border command draws: one side of the selection, or a preset. */
export type BorderTarget = CellSide | "all" | "outer" | "inner" | "none";
export type Weight = "thin" | "thick";
type SideWeight = "none" | Weight;

const OPPOSITE: Record<CellSide, CellSide> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

function tableAt(state: EditorState): { pos: number; width: TableWidth } | null {
  const $from = state.selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "table") {
      return { pos: $from.before(d), width: node.attrs.width === "fit" ? "fit" : "full" };
    }
  }
  return null;
}

export const tableWidthAt = (state: EditorState): TableWidth | null =>
  tableAt(state)?.width ?? null;

export function setTableWidth(state: EditorState, width: TableWidth): Transaction | null {
  const t = tableAt(state);
  if (!t) return null;
  const node = state.doc.nodeAt(t.pos)!;
  return state.tr.setNodeMarkup(t.pos, undefined, {
    ...node.attrs,
    width: width === "fit" ? "fit" : null,
  });
}

/** Cells may merge across one row only; the schema has no row spans. */
export function canMergeInRow(state: EditorState): boolean {
  if (!(state.selection instanceof CellSelection)) return false;
  const rect = selectedRect(state);
  return rect.bottom - rect.top === 1 && rect.right - rect.left > 1;
}

type Edge = { row: number; col: number; side: CellSide };

/** The cell sides along one edge of the selection rectangle. */
function edgeSides(rect: TableRect, target: BorderTarget): Edge[] {
  const { map, top, bottom, left, right } = rect;
  const cellAt = (row: number, col: number) => map.map[row * map.width + col];
  const out: Edge[] = [];
  const horizontal = (row: number) => {
    for (let col = left; col < right; col++) out.push({ row, col, side: "top" });
  };
  const vertical = (col: number) => {
    for (let row = top; row < bottom; row++) {
      // Inside a merged cell there is no edge to draw.
      if (col > 0 && col < map.width && cellAt(row, col) === cellAt(row, col - 1)) continue;
      out.push({ row, col, side: "left" });
    }
  };
  const edges = { top: false, bottom: false, left: false, right: false, inner: false };
  if (target === "all" || target === "none") {
    Object.assign(edges, { top: true, bottom: true, left: true, right: true, inner: true });
  } else if (target === "outer") {
    Object.assign(edges, { top: true, bottom: true, left: true, right: true });
  } else if (target === "inner") {
    edges.inner = true;
  } else {
    edges[target] = true;
  }
  if (edges.top) horizontal(top);
  if (edges.bottom) horizontal(bottom);
  if (edges.left) vertical(left);
  if (edges.right) vertical(right);
  if (edges.inner) {
    for (let row = top + 1; row < bottom; row++) horizontal(row);
    for (let col = left + 1; col < right; col++) vertical(col);
  }
  return out;
}

/** An edge is the "top" of the row below it and the "bottom" of the row
 *  above it (likewise left/right); return both cell sides that exist. */
function cellSides(rect: TableRect, e: Edge): { pos: number; side: CellSide }[] {
  const { map, tableStart } = rect;
  const out: { pos: number; side: CellSide }[] = [];
  const at = (row: number, col: number, side: CellSide) => {
    if (row < 0 || row >= map.height || col < 0 || col >= map.width) return;
    out.push({ pos: tableStart + map.map[row * map.width + col], side });
  };
  if (e.side === "top") {
    at(e.row, e.col, "top");
    at(e.row - 1, e.col, OPPOSITE.top);
  } else {
    at(e.row, e.col, "left");
    at(e.row, e.col - 1, OPPOSITE.left);
  }
  return out;
}

const sideOf = (state: EditorState, pos: number, side: CellSide): SideWeight =>
  (state.doc.nodeAt(pos)?.attrs.borders as CellBorders | null)?.[side] ?? "thin";

/** True when every cell side along `target` already has `weight`. */
export function bordersAre(state: EditorState, target: CellSide, weight: Weight): boolean {
  if (!isInTable(state)) return false;
  const rect = selectedRect(state);
  return edgeSides(rect, target)
    .flatMap((e) => cellSides(rect, e))
    .every(({ pos, side }) => sideOf(state, pos, side) === weight);
}

/**
 * Presets (all, outer, inner) draw `weight` along their edges; "none"
 * clears every edge of the selection. A single side toggles: drawn at
 * `weight` unless it already is, in which case it is removed.
 */
export function setBorders(
  state: EditorState,
  target: BorderTarget,
  weight: Weight,
): Transaction | null {
  if (!isInTable(state)) return null;
  let value: SideWeight = target === "none" ? "none" : weight;
  if (target !== "all" && target !== "outer" && target !== "inner" && target !== "none") {
    if (bordersAre(state, target, weight)) value = "none";
  }
  const changes = new Map<number, CellBorders & Partial<Record<CellSide, SideWeight>>>();
  const rect = selectedRect(state);
  for (const e of edgeSides(rect, target)) {
    for (const { pos, side } of cellSides(rect, e)) {
      const cur = changes.get(pos) ?? { ...(state.doc.nodeAt(pos)?.attrs.borders ?? {}) };
      cur[side] = value;
      changes.set(pos, cur);
    }
  }
  const tr = state.tr;
  for (const [pos, raw] of changes) {
    const node = tr.doc.nodeAt(pos)!;
    const borders: CellBorders = {};
    for (const [side, w] of Object.entries(raw) as [CellSide, SideWeight][]) {
      if (w === "none" || w === "thick") borders[side] = w;
    }
    tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      borders: Object.keys(borders).length ? borders : null,
    });
  }
  return tr;
}

/**
 * Resizing writes a width only for the dragged column; the editor shows
 * the unsized ones sharing what is left, which the outputs can't know.
 * So once a table has any width, record the rest as measured on screen
 * (`measure`: a cell's rendered width, null when unknown). Tables with
 * no widths, or all of them, are left alone.
 */
export function fillColumnWidths(
  state: EditorState,
  measure: (cellPos: number) => number | null,
): Transaction | null {
  const tr = state.tr;
  state.doc.descendants((node, pos) => {
    if (node.type.name !== "table") return true;
    const map = TableMap.get(node);
    const start = pos + 1;
    const known: (number | null)[] = Array(map.width).fill(null);
    const single: (number | null)[] = Array(map.width).fill(null);
    for (let row = 0; row < map.height; row++) {
      for (let col = 0; col < map.width; col++) {
        const cellPos = map.map[row * map.width + col];
        const cell = node.nodeAt(cellPos)!;
        const w = (cell.attrs.colwidth as number[] | null)?.[col - map.colCount(cellPos)];
        if (w && w > 0 && known[col] === null) known[col] = w;
        if (cell.attrs.colspan === 1 && single[col] === null) single[col] = cellPos;
      }
    }
    const unset = known.flatMap((w, col) => (w === null ? [col] : []));
    if (unset.length === 0 || unset.length === map.width) return true;
    for (const col of unset) {
      const at = single[col];
      const w = at === null ? null : measure(start + at);
      if (!w || w <= 0) return true;
      known[col] = Math.round(w);
    }
    const seen = new Set<number>();
    for (const cellPos of map.map) {
      if (seen.has(cellPos)) continue;
      seen.add(cellPos);
      const cell = node.nodeAt(cellPos)!;
      const first = map.colCount(cellPos);
      const colwidth = known.slice(first, first + (cell.attrs.colspan as number));
      tr.setNodeMarkup(tr.mapping.map(start + cellPos), undefined, { ...cell.attrs, colwidth });
    }
    return true;
  });
  return tr.docChanged ? tr.setMeta("addToHistory", false) : null;
}
