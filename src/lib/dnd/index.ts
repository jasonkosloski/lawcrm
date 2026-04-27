/**
 * Drag-and-drop utilities — re-exports.
 *
 * Generic, feature-agnostic. Calendar uses these; kanban will use
 * these; future workflows that need DnD use these. See
 * `payload.ts` for the philosophy and `use-drop-target.ts` for
 * the consumer-side hook.
 */

export {
  setDragPayload,
  readPayload,
  hasKind,
  type DragPayload,
} from "./payload";

export {
  useDropTarget,
  type UseDropTargetOptions,
  type UseDropTargetResult,
} from "./use-drop-target";

export {
  setActiveDrag,
  clearActiveDrag,
  peekActiveDrag,
} from "./active-drag";
