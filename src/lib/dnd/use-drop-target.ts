/**
 * `useDropTarget` — small hook that pairs `dragover` highlight
 * state with the payload-kind check. Wraps the verbose native
 * drag handlers into something feature components can apply with
 * a `<div {...handlers}>` spread.
 *
 * Designed for both calendar (event chip → time slot / all-day
 * bar) and the future kanban (matter card → stage column). The
 * hook is generic over the payload type — callers pass the
 * `kind` and a payload-typed `onDrop` callback, and they get
 * back handler props plus an `isOver` flag for the visual
 * highlight.
 */

"use client";

import { useState, type DragEventHandler } from "react";
import { hasKind, readPayload } from "./payload";

export type UseDropTargetOptions<D> = {
  /** Must match the source's `setDragPayload({ kind, ... })`. */
  kind: string;
  /** Fires when the user drops a matching payload on this target. */
  onDrop: (data: D, event: React.DragEvent) => void;
  /** Optional — disable the target without unmounting. Useful for
   *  permission-gated areas: pass `disabled={!canEdit}`. */
  disabled?: boolean;
};

export type UseDropTargetResult = {
  isOver: boolean;
  /** Spread onto the drop target element. */
  handlers: {
    onDragOver: DragEventHandler;
    onDragEnter: DragEventHandler;
    onDragLeave: DragEventHandler;
    onDrop: DragEventHandler;
  };
};

export function useDropTarget<D>(
  options: UseDropTargetOptions<D>
): UseDropTargetResult {
  const { kind, onDrop, disabled = false } = options;
  // We use a counter (not a boolean) because dragenter/dragleave
  // fire for every nested child — naively flipping a boolean
  // produces flicker as the cursor crosses a child boundary.
  // Counting enters minus leaves gives a stable "is the cursor
  // anywhere inside this target" signal.
  const [enterCount, setEnterCount] = useState(0);

  const reset = () => setEnterCount(0);

  const handlers: UseDropTargetResult["handlers"] = {
    onDragOver: (e) => {
      if (disabled) return;
      if (!hasKind(e, kind)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    },
    onDragEnter: (e) => {
      if (disabled) return;
      if (!hasKind(e, kind)) return;
      setEnterCount((n) => n + 1);
    },
    onDragLeave: (e) => {
      if (disabled) return;
      if (!hasKind(e, kind)) return;
      setEnterCount((n) => Math.max(0, n - 1));
    },
    onDrop: (e) => {
      reset();
      if (disabled) return;
      const payload = readPayload<D>(e, kind);
      if (!payload) return;
      e.preventDefault();
      onDrop(payload, e);
    },
  };

  return { isOver: enterCount > 0, handlers };
}
