/**
 * Shared state for the Documents tab's file-manager layer (see
 * documents-workspace.tsx): the selection, what's being dragged, and
 * the action runner. The tree rail, breadcrumbs and table rows read it
 * to become drop targets and to open the shared menus.
 */

"use client";

import { createContext, useContext } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { ActionTarget, EntryAction, EntryActionId, WorkspacePerms } from "@/lib/document-entry-actions";
import type { ClickMods, EntryKey, Selection } from "@/lib/document-selection";

export type WorkspaceCtx = {
  perms: WorkspacePerms;
  selection: Selection;
  /** Click / ⌘-click / shift-click on a row (or its checkbox). */
  select: (key: EntryKey, mods: ClickMods) => void;
  setSelection: (keys: EntryKey[]) => void;
  /** Rows hidden while a drag-move is in flight. */
  hidden: ReadonlySet<EntryKey>;
  /** Set while rows are being dragged. */
  dragging: { keys: ReadonlySet<EntryKey> } | null;
  /** Whether the dragged rows may drop on this folder (null = root). */
  canDropOn: (folderId: string | null) => boolean;
  /** Folder under a desktop-file drag (null = root); undefined when
   *  no files are being dragged. */
  fileDropFolder: string | null | undefined;
  actionsFor: (targets: ActionTarget[]) => EntryAction[];
  run: (id: EntryActionId, targets: ActionTarget[]) => void;
};

export const WorkspaceContext = createContext<WorkspaceCtx | null>(null);

export const useWorkspace = () => useContext(WorkspaceContext);

export type DropState = "idle" | "over" | "blocked";

/**
 * Makes a folder (tree node, folder row, breadcrumb) a drop target for
 * dragged rows and desktop files. Outside a workspace it does nothing.
 * `place` keeps ids unique: one folder shows up in several places.
 */
export function useFolderDropTarget(folderId: string | null, place: "tree" | "row" | "crumb") {
  const ws = useWorkspace();
  const { setNodeRef, isOver } = useDroppable({
    id: `drop:${place}:${folderId ?? "root"}`,
    data: { folderId },
    disabled: !ws?.perms.organize,
  });
  let state: DropState = "idle";
  if (ws?.dragging && isOver) state = ws.canDropOn(folderId) ? "over" : "blocked";
  else if (ws && ws.fileDropFolder !== undefined && ws.fileDropFolder === folderId && place !== "crumb") {
    state = "over";
  }
  return {
    setNodeRef,
    isOver: isOver && !!ws?.dragging,
    state,
    /** Spread on the element so a desktop-file drop can find its folder. */
    dropProps: { "data-drop-folder": folderId ?? "" },
  };
}

export const dropStateClass = (state: DropState) =>
  state === "over"
    ? "ring-2 ring-brand-500 bg-brand-soft"
    : state === "blocked"
      ? "ring-2 ring-danger/40 cursor-no-drop"
      : "";
