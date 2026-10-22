/**
 * Pure helpers behind the Documents tab's file-manager interactions:
 * Drive-style row selection (click / ⌘-click / shift-click ranges) and
 * whether a drag can drop on a folder. The server actions re-check
 * every move; these only drive the UI (no-drop cursor, disabled menu
 * items) so a doomed move never starts.
 */

import {
  MAX_FOLDER_DEPTH,
  collectDescendantIds,
  folderDepth,
  subtreeHeight,
  type FolderRecord,
} from "@/lib/folder-tree";

/** Row key: `folder:<id>` or `doc:<id>`. */
export type EntryKey = `folder:${string}` | `doc:${string}`;

export const folderKey = (id: string): EntryKey => `folder:${id}`;
export const docKey = (id: string): EntryKey => `doc:${id}`;

export function parseEntryKey(key: EntryKey): { kind: "folder" | "doc"; id: string } {
  const i = key.indexOf(":");
  return { kind: key.slice(0, i) as "folder" | "doc", id: key.slice(i + 1) };
}

export type Selection = {
  keys: ReadonlySet<EntryKey>;
  /** Where a shift-click range starts. */
  anchor: EntryKey | null;
};

export const EMPTY_SELECTION: Selection = { keys: new Set(), anchor: null };

export type ClickMods = { toggle: boolean; range: boolean };

/**
 * Selection after clicking `key` in a list ordered as `order`:
 * plain = only it; toggle (⌘/Ctrl, or the checkbox) = add/remove it;
 * range (shift) = everything from the anchor to it, added to the
 * selection when toggle is held too (Finder/Drive behaviour).
 */
export function applyClick(
  sel: Selection,
  key: EntryKey,
  order: readonly EntryKey[],
  mods: ClickMods,
): Selection {
  if (mods.range && sel.anchor && order.includes(sel.anchor)) {
    const a = order.indexOf(sel.anchor);
    const b = order.indexOf(key);
    const span = order.slice(Math.min(a, b), Math.max(a, b) + 1);
    const keys = new Set<EntryKey>(mods.toggle ? sel.keys : []);
    for (const k of span) keys.add(k);
    return { keys, anchor: sel.anchor };
  }
  if (mods.toggle) {
    const keys = new Set(sel.keys);
    if (keys.has(key)) keys.delete(key);
    else keys.add(key);
    return { keys, anchor: key };
  }
  return { keys: new Set([key]), anchor: key };
}

/** Keep only keys still present (rows vanish after a move or delete). */
export function pruneSelection(sel: Selection, order: readonly EntryKey[]): Selection {
  const present = new Set(order);
  const keys = new Set([...sel.keys].filter((k) => present.has(k)));
  if (keys.size === sel.keys.size && (!sel.anchor || present.has(sel.anchor))) return sel;
  return { keys, anchor: sel.anchor && present.has(sel.anchor) ? sel.anchor : null };
}

/** What's being dragged / moved. */
export type MovePayload = {
  docs: { id: string; folderId: string | null; isAttachment: boolean }[];
  folders: { id: string; parentId: string | null; isProtected: boolean }[];
};

/**
 * Why `payload` can't move into `targetId` (null = the root), or null
 * when it can. Mirrors the server's refusals: attachments live under
 * their email, generated folders are fixed, a folder can't go inside
 * itself, the depth cap. Dropping everything where it already lives is
 * refused too (a no-op shouldn't flash a toast).
 */
export function moveBlockReason(
  payload: MovePayload,
  targetId: string | null,
  folders: FolderRecord[],
): string | null {
  if (payload.docs.length + payload.folders.length === 0) return "Nothing selected.";
  if (payload.docs.some((d) => d.isAttachment)) {
    return "Email attachments move with their email.";
  }
  if (payload.folders.some((f) => f.isProtected)) {
    return "Folders made by a records request can't be moved.";
  }
  for (const f of payload.folders) {
    if (targetId === f.id || (targetId && collectDescendantIds(folders, f.id).has(targetId))) {
      return "A folder can't be moved into itself.";
    }
    const destDepth = targetId ? folderDepth(folders, targetId) : 0;
    if (destDepth + subtreeHeight(folders, f.id) > MAX_FOLDER_DEPTH) {
      return `Folders can't nest more than ${MAX_FOLDER_DEPTH} levels deep.`;
    }
  }
  const allInPlace =
    payload.docs.every((d) => d.folderId === targetId) &&
    payload.folders.every((f) => f.parentId === targetId);
  if (allInPlace) return "Already here.";
  return null;
}
