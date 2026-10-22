/**
 * Documents workspace — the client half of the Documents tab (the
 * server half, documents-browser.tsx, loads the data and the
 * permission flags). Works like Drive/Dropbox:
 *
 * - Selection: click, ⌘/Ctrl-click, shift-click, checkboxes, ⌘A. A
 *   bar above the list acts on everything selected.
 * - Right-click a row (or the selection), empty space, or a tree folder
 *   for the same actions as the row's ⋯ menu. One list
 *   (document-entry-actions.ts) feeds every menu.
 * - Drag rows onto a folder row, a tree folder (collapsed ones spring
 *   open) or a breadcrumb to move them; the rows leave at once and
 *   come back if the server refuses. Every move toasts an Undo.
 * - Drop files from the desktop anywhere on the tab to upload into the
 *   current folder, or onto a folder to upload there.
 *
 * Mutations are the existing server actions (each re-checks its
 * permission and the matter/lead scope); bulk work calls them per item
 * so every guard (evidence flags, protected folders) still applies.
 */

"use client";

import { useCallback, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { FileText, Folder, Upload, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { moveDocuments, moveFolder, deleteFolder } from "@/app/actions/document-folders";
import { copyDocumentToFolder, deleteDocument } from "@/app/actions/documents";
import { previewFolderMoveVisibility, setDocumentsClientShare, setFolderClientShared } from "@/app/actions/portal-documents";
import { COPY_DESCRIPTION } from "@/components/documents-viewer/document-placement";
import { FolderTree } from "@/components/matters/documents/folder-tree";
import { MoveToFolderDialog } from "@/components/matters/documents/move-to-folder-dialog";
import { MultiFileUpload, type MultiFileUploadHandle } from "@/components/matters/documents/multi-file-upload";
import { NewFolderButton, NewFolderDialog } from "@/components/matters/documents/new-folder-button";
import { RenameFolderDialog } from "@/components/matters/documents/rename-folder-dialog";
import { EditDocumentDialog } from "@/components/matters/documents/edit-document-dialog";
import { DeleteDocumentDialog } from "@/components/matters/documents/delete-document-dialog";
import { confirmAction, notifyError, notifySuccess, notifyUndoable } from "@/lib/feedback";
import { collectDescendantIds, MAX_FOLDER_DEPTH, MOVE_DOCUMENTS_BATCH_CAP, folderDepth, type FlatFolder, type FolderNode, type FolderRecord } from "@/lib/folder-tree";
import { isProtectedFolder } from "@/lib/records-requests/folder-kinds";
import { visibilityWarning } from "@/lib/portal/move-warning";
import { visibilityChangeForMove } from "@/lib/portal/share-delta";
import type { RecordScope } from "@/lib/record-scope";
import type { StorageDriver } from "@/lib/storage/storage-key";
import {
  backgroundActions,
  entryActions,
  type ActionTarget,
  type DocTarget,
  type EntryAction,
  type EntryActionId,
  type FolderTarget,
  type WorkspacePerms,
} from "@/lib/document-entry-actions";
import {
  EMPTY_SELECTION,
  applyClick,
  folderKey,
  moveBlockReason,
  pruneSelection,
  type EntryKey,
  type MovePayload,
  type Selection,
} from "@/lib/document-selection";
import { cn, plural } from "@/lib/utils";
import { DocumentsTable, type RowData } from "./documents-table";
import { EntryMenuItems, ACTION_ICONS } from "./entry-menu";
import { FolderBreadcrumbs } from "./folder-breadcrumbs";
import { WorkspaceContext, type WorkspaceCtx } from "./workspace-context";

export type WorkspaceFolder = FolderRecord & { clientShared: boolean };

type MenuTarget =
  | { kind: "entries"; targets: ActionTarget[] }
  | { kind: "background"; folderId: string | null };

/** Actions the selection bar shows as buttons. */
const BAR_ACTIONS: EntryActionId[] = ["download", "move", "copy", "share", "unshare", "delete"];

export function DocumentsWorkspace({
  scope,
  basePath,
  folders,
  flat,
  tree,
  counts,
  rootCount,
  currentFolderId,
  rows,
  perms,
  storageDriver,
  visibilityWarnings,
  toolbarNote,
  empty,
  children,
}: {
  scope: RecordScope;
  /** `/matters/[id]/documents` or the intake equivalent. */
  basePath: string;
  folders: WorkspaceFolder[];
  flat: FlatFolder[];
  tree: FolderNode[];
  counts: Record<string, number>;
  rootCount: number;
  /** The browsed folder (null = root), already validated. */
  currentFolderId: string | null;
  rows: RowData[];
  perms: WorkspacePerms;
  storageDriver: StorageDriver;
  /** Matter + portal: warn when a move changes what the client sees. */
  visibilityWarnings: boolean;
  /** Shown after the breadcrumbs (e.g. the no-portal-access hint). */
  toolbarNote?: ReactNode;
  /** The empty-folder card, rendered when there are no rows. */
  empty: ReactNode;
  /** Below the list (the single-file composer + templates). */
  children?: ReactNode;
}) {
  const router = useRouter();
  const uploadRef = useRef<MultiFileUploadHandle>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const pickerFolder = useRef<string | null>(null);
  const suppressClickUntil = useRef(0);
  const fileDragDepth = useRef(0);

  const [selection, setSelectionState] = useState<Selection>(EMPTY_SELECTION);
  const [hidden, setHidden] = useState<ReadonlySet<EntryKey>>(new Set());
  const [dragging, setDragging] = useState<{ keys: ReadonlySet<EntryKey>; payload: MovePayload; targets: ActionTarget[] } | null>(null);
  const [fileDropFolder, setFileDropFolder] = useState<string | null | undefined>(undefined);
  const [menu, setMenu] = useState<MenuTarget>({ kind: "background", folderId: currentFolderId });

  // Dialogs opened from menus, the bar and shortcuts.
  const [moveTargets, setMoveTargets] = useState<ActionTarget[] | null>(null);
  const [copyTargets, setCopyTargets] = useState<DocTarget[] | null>(null);
  const [editDoc, setEditDoc] = useState<DocTarget | null>(null);
  const [renameTarget, setRenameTarget] = useState<FolderTarget | null>(null);
  const [deleteEmail, setDeleteEmail] = useState<DocTarget | null>(null);
  const [newFolderParent, setNewFolderParent] = useState<string | null | undefined>(undefined);
  // One bulk mutation at a time: a double-click must not share (and
  // email the client) twice.
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const exclusive = async (work: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await work();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const folderById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const folderName = (id: string | null) => (id === null ? "All documents" : (folderById.get(id)?.name ?? "folder"));
  const order = useMemo(() => rows.map((r) => r.key), [rows]);
  const rowByKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);

  // Rows vanish after moves and deletes: drop them from the selection
  // (render-phase adjust, not an effect).
  const [prevRows, setPrevRows] = useState(rows);
  if (prevRows !== rows) {
    setPrevRows(rows);
    const pruned = pruneSelection(selection, order);
    if (pruned !== selection) setSelectionState(pruned);
  }
  // A new folder starts with nothing selected.
  const [prevFolder, setPrevFolder] = useState(currentFolderId);
  if (prevFolder !== currentFolderId) {
    setPrevFolder(currentFolderId);
    setSelectionState(EMPTY_SELECTION);
  }

  const atDepthCap = (id: string | null) => id !== null && folderDepth(folders, id) >= MAX_FOLDER_DEPTH;

  /** A tree folder that may not be in the current listing. */
  const folderTarget = (id: string): FolderTarget | null => {
    const f = folderById.get(id);
    if (!f) return null;
    const row = rowByKey.get(folderKey(id));
    if (row) return row.target as FolderTarget;
    const below = collectDescendantIds(folders, id);
    return {
      kind: "folder",
      id,
      name: f.name,
      href: `${basePath}?folder=${id}`,
      parentId: f.parentId,
      isProtected: isProtectedFolder({ systemKind: f.systemKind ?? null }),
      hasProtectedDescendant: folders.some((x) => below.has(x.id) && isProtectedFolder({ systemKind: x.systemKind ?? null })),
      clientShared: f.clientShared,
      atDepthCap: atDepthCap(id),
    };
  };

  const selectedTargets = order.filter((k) => selection.keys.has(k)).map((k) => rowByKey.get(k)!.target);

  // ── Mutations ──────────────────────────────────────────────────────

  /** What moving `targets` to `dest` does to what the client sees, or
   *  null. Files are worked out here; a folder's whole subtree is asked
   *  of the server. A failed preview never blocks the move. */
  const moveVisibilityWarning = async (targets: ActionTarget[], dest: string | null): Promise<string | null> => {
    if (!visibilityWarnings) return null;
    const docs = targets.filter((t): t is DocTarget => t.kind === "doc" && t.folderId !== dest);
    const fs = targets.filter((t): t is FolderTarget => t.kind === "folder" && t.parentId !== dest);
    const delta = visibilityChangeForMove(
      docs.flatMap((d) => [{ clientShare: d.clientShare, folderId: d.folderId, status: d.status }, ...d.attachmentShares]),
      dest,
      folders
    );
    try {
      for (const f of fs) {
        const r = await previewFolderMoveVisibility(f.id, dest);
        delta.becomesVisible += r.becomesVisible;
        delta.becomesHidden += r.becomesHidden;
      }
    } catch {
      /* advisory only */
    }
    return visibilityWarning(delta);
  };

  /** Undo a move: everything goes back where it was. */
  const undoMove = async (moved: { docs: { id: string; from: string | null }[]; folders: { id: string; from: string | null }[] }) => {
    const byFrom = new Map<string | null, string[]>();
    for (const d of moved.docs) byFrom.set(d.from, [...(byFrom.get(d.from) ?? []), d.id]);
    const errors: string[] = [];
    for (const [from, ids] of byFrom) {
      const res = await moveDocuments(ids, from);
      if (!res.ok) errors.push(res.error);
    }
    for (const f of moved.folders) {
      const res = await moveFolder(f.id, f.from);
      if (!res.ok) errors.push(res.error);
    }
    if (errors.length) notifyError(`Couldn't undo the whole move: ${errors[0]}`);
    else notifySuccess("Move undone.");
  };

  /** Move rows to a folder; toasts Undo. Partial failures report the
   *  first error but keep what moved. */
  const moveTo = async (targets: ActionTarget[], dest: string | null): Promise<{ ok: boolean; error?: string }> => {
    const docs = targets.filter((t): t is DocTarget => t.kind === "doc" && t.folderId !== dest);
    const fs = targets.filter((t): t is FolderTarget => t.kind === "folder" && t.parentId !== dest);
    const moved = { docs: [] as { id: string; from: string | null }[], folders: [] as { id: string; from: string | null }[] };
    const errors: string[] = [];
    for (let i = 0; i < docs.length; i += MOVE_DOCUMENTS_BATCH_CAP) {
      const chunk = docs.slice(i, i + MOVE_DOCUMENTS_BATCH_CAP);
      const res = await moveDocuments(chunk.map((d) => d.id), dest);
      if (res.ok) moved.docs.push(...chunk.map((d) => ({ id: d.id, from: d.folderId })));
      else errors.push(res.error);
    }
    for (const f of fs) {
      const res = await moveFolder(f.id, dest);
      if (res.ok) moved.folders.push({ id: f.id, from: f.parentId });
      else errors.push(res.error);
    }
    const n = moved.docs.length + moved.folders.length;
    if (n === 0) return { ok: false, error: errors[0] ?? "Nothing to move." };
    const what = n === 1 ? `"${(docs.find((d) => d.id === moved.docs[0]?.id) ?? fs.find((f) => f.id === moved.folders[0]?.id))?.name}"` : plural(n, "item");
    notifyUndoable(`Moved ${what} to ${folderName(dest)}.`, () => void undoMove(moved));
    if (errors.length) notifyError(`${plural(errors.length, "item")} didn't move: ${errors[0]}`);
    return { ok: true };
  };

  const copyTo = async (docs: DocTarget[], dest: string | null): Promise<{ ok: boolean; error?: string }> => {
    const errors: string[] = [];
    for (const d of docs) {
      const res = await copyDocumentToFolder(d.id, dest);
      if (!res.ok) errors.push(res.error ?? "Couldn't copy.");
    }
    if (errors.length === docs.length) return { ok: false, error: errors[0] };
    notifySuccess(`Copied ${docs.length === 1 ? `"${docs[0]!.name}"` : plural(docs.length - errors.length, "file")} to ${folderName(dest)}.`);
    if (errors.length) notifyError(`${plural(errors.length, "file")} didn't copy: ${errors[0]}`);
    return { ok: true };
  };

  const setShared = (targets: ActionTarget[], shared: boolean) => exclusive(async () => {
    const docIds = targets.filter((t) => t.kind === "doc").map((t) => t.id);
    const errors: string[] = [];
    if (docIds.length) {
      const res = await setDocumentsClientShare(docIds, shared);
      if (!res.ok) errors.push(res.error ?? "Couldn't update sharing.");
    }
    for (const f of targets.filter((t) => t.kind === "folder")) {
      const res = await setFolderClientShared(f.id, shared);
      if (!res.ok) errors.push(res.error ?? "Couldn't update sharing.");
    }
    if (errors.length) notifyError(errors[0]!);
  });

  const deleteTargets = async (targets: ActionTarget[]) => {
    if (targets.length === 1) {
      const t = targets[0]!;
      if (t.kind === "doc" && t.unsavedAttachments.length + t.savedAttachments.length > 0) {
        setDeleteEmail(t);
        return;
      }
    }
    const docs = targets.filter((t): t is DocTarget => t.kind === "doc");
    const fs = targets.filter((t): t is FolderTarget => t.kind === "folder");
    const single = targets.length === 1 ? targets[0]! : null;
    const notes: string[] = [];
    if (docs.length) notes.push("Deleted files can't be recovered. Copies in other folders are separate documents and aren't affected.");
    if (fs.length) notes.push("Deleting a folder never deletes what's inside — its subfolders and files move up one level.");
    const kept = docs.reduce((n, d) => n + d.unsavedAttachments.length, 0);
    if (kept > 0) {
      notes.push(
        `${plural(kept, "attachment")} of the selected emails will be kept in their folder. To delete an email's attachments too, delete that email on its own.`
      );
    }
    const ok = await confirmAction({
      title: single
        ? single.kind === "folder"
          ? `Delete the folder "${single.name}"?`
          : `Delete "${single.name}"?`
        : `Delete ${plural(targets.length, "item")}?`,
      description: notes.join(" "),
      confirmLabel: single ? (single.kind === "folder" ? "Delete folder" : "Delete document") : `Delete ${plural(targets.length, "item")}`,
      destructive: true,
    });
    if (!ok) return;
    await exclusive(async () => {
      const errors: string[] = [];
      // Selected attachments first: deleting their email can take a
      // saved one along, and a second delete would report "not found".
      const ordered = [...docs.filter((d) => d.isAttachment), ...docs.filter((d) => !d.isAttachment)];
      for (const d of ordered) {
        const res = await deleteDocument(d.id, d.unsavedAttachments.length ? { attachments: "keep" } : {});
        if (!res.ok) errors.push(res.error ?? "Couldn't delete document.");
      }
      for (const f of fs) {
        const res = await deleteFolder(f.id);
        if (!res.ok) errors.push(res.error);
      }
      if (errors.length) {
        notifyError(targets.length === 1 ? errors[0]! : `${plural(errors.length, "item")} weren't deleted: ${errors[0]}`);
      }
    });
  };

  const download = (docs: DocTarget[]) => {
    // One anchor per file, spaced out: browsers drop rapid-fire
    // downloads (Chrome asks once to allow several).
    docs
      .filter((d) => d.hasFile)
      .forEach((d, i) => {
        setTimeout(() => {
          const a = document.createElement("a");
          a.href = `/api/documents/${d.id}/download?download=1`;
          a.rel = "noopener";
          document.body.appendChild(a);
          a.click();
          a.remove();
        }, i * 350);
      });
  };

  const openPicker = (folderId: string | null) => {
    pickerFolder.current = folderId;
    pickerRef.current?.click();
  };

  // ── Action runner (menus, bar, shortcuts) ──────────────────────────

  const run = (id: EntryActionId, targets: ActionTarget[], bgFolder: string | null = currentFolderId) => {
    const single = targets.length === 1 ? targets[0]! : null;
    switch (id) {
      case "open":
        if (single) router.push(single.href);
        return;
      case "open-new-tab":
        if (single) window.open(single.href, "_blank", "noopener");
        return;
      case "download":
        download(targets.filter((t): t is DocTarget => t.kind === "doc"));
        return;
      case "new-folder":
        setNewFolderParent(single?.kind === "folder" ? single.id : bgFolder);
        return;
      case "upload":
        openPicker(single?.kind === "folder" ? single.id : bgFolder);
        return;
      case "edit":
        if (single?.kind === "doc") setEditDoc(single);
        return;
      case "rename":
        if (single?.kind === "folder") setRenameTarget(single);
        return;
      case "move":
        setMoveTargets(targets);
        return;
      case "copy":
        setCopyTargets(targets.filter((t): t is DocTarget => t.kind === "doc"));
        return;
      case "share":
      case "unshare":
        void setShared(targets, id === "share");
        return;
      case "select-all":
        setSelectionState({ keys: new Set(order), anchor: order[0] ?? null });
        return;
      case "delete":
        void deleteTargets(targets);
        return;
    }
  };

  // ── Drag and drop (rows) ───────────────────────────────────────────

  const sensors = useSensors(
    // A small distance so plain clicks still select / open.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Long-press on touch so the list still scrolls.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } })
  );

  const payloadOf = (targets: ActionTarget[]): MovePayload => ({
    docs: targets
      .filter((t): t is DocTarget => t.kind === "doc")
      .map((d) => ({ id: d.id, folderId: d.folderId, isAttachment: d.isAttachment })),
    folders: targets
      .filter((t): t is FolderTarget => t.kind === "folder")
      .map((f) => ({ id: f.id, parentId: f.parentId, isProtected: f.isProtected })),
  });

  const onDragStart = (e: DragStartEvent) => {
    const key = e.active.id as EntryKey;
    // Dragging an unselected row drags just it (and selects it).
    const keys = selection.keys.has(key) ? new Set(selection.keys) : new Set([key]);
    if (!selection.keys.has(key)) setSelectionState({ keys, anchor: key });
    const targets = order.filter((k) => keys.has(k)).map((k) => rowByKey.get(k)!.target);
    setDragging({ keys, targets, payload: payloadOf(targets) });
  };

  const onDragEnd = (e: DragEndEvent) => {
    const drag = dragging;
    setDragging(null);
    // The pointer-up can land as a click on the row's link.
    suppressClickUntil.current = Date.now() + 150;
    const over = e.over?.data.current as { folderId: string | null } | undefined;
    if (!drag || !over) return;
    const reason = moveBlockReason(drag.payload, over.folderId, folders);
    if (reason) {
      if (reason !== "Already here.") notifyError(reason);
      return;
    }
    const dest = over.folderId;
    void exclusive(async () => {
      // Same heads-up as the Move dialog before the client's view changes.
      const warning = await moveVisibilityWarning(drag.targets, dest);
      if (
        warning &&
        !(await confirmAction({ title: `Move to ${folderName(dest)}?`, description: warning, confirmLabel: "Move" }))
      ) {
        return;
      }
      setHidden(new Set(drag.keys));
      const res = await moveTo(drag.targets, dest);
      if (!res.ok) notifyError(res.error ?? "Couldn't move.");
      setHidden(new Set());
    });
  };

  const canDropOn = useCallback(
    (folderId: string | null) => !!dragging && moveBlockReason(dragging.payload, folderId, folders) === null,
    [dragging, folders]
  );

  // ── Desktop files ──────────────────────────────────────────────────

  const acceptsFiles = perms.writable && perms.upload;
  const isFileDrag = (e: DragEvent) => acceptsFiles && Array.from(e.dataTransfer.types).includes("Files");
  const dropFolderAt = (el: EventTarget | null): string | null => {
    const hit = (el as HTMLElement | null)?.closest?.<HTMLElement>("[data-drop-folder]");
    if (!hit) return currentFolderId;
    return hit.dataset.dropFolder || null;
  };

  const fileDragHandlers = {
    onDragEnter: (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      fileDragDepth.current += 1;
      setFileDropFolder(dropFolderAt(e.target));
    },
    onDragOver: (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      const f = dropFolderAt(e.target);
      if (f !== fileDropFolder) setFileDropFolder(f);
    },
    onDragLeave: (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      fileDragDepth.current = Math.max(0, fileDragDepth.current - 1);
      if (fileDragDepth.current === 0) setFileDropFolder(undefined);
    },
    onDrop: (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      fileDragDepth.current = 0;
      setFileDropFolder(undefined);
      const files = Array.from(e.dataTransfer.files);
      if (files.length) uploadRef.current?.upload(files, dropFolderAt(e.target));
    },
  };

  // ── Context menus ──────────────────────────────────────────────────

  const onListContextMenu = (e: React.MouseEvent) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-entry-key]");
    if (!row) {
      setSelectionState(EMPTY_SELECTION);
      setMenu({ kind: "background", folderId: currentFolderId });
      return;
    }
    const key = row.dataset.entryKey as EntryKey;
    const keys = selection.keys.has(key) ? selection.keys : new Set([key]);
    if (!selection.keys.has(key)) setSelectionState({ keys, anchor: key });
    setMenu({ kind: "entries", targets: order.filter((k) => keys.has(k)).map((k) => rowByKey.get(k)!.target) });
  };

  const onTreeContextMenu = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-drop-folder]");
    const id = el?.dataset.dropFolder || null;
    const t = id ? folderTarget(id) : null;
    setMenu(t ? { kind: "entries", targets: [t] } : { kind: "background", folderId: null });
  };

  const menuActions: EntryAction[] =
    menu.kind === "entries"
      ? entryActions(menu.targets, perms)
      : backgroundActions(perms, {
          atDepthCap: atDepthCap(menu.folderId),
          hasEntries: menu.folderId === currentFolderId && rows.length > 0,
        });
  const runMenu = (id: EntryActionId) =>
    menu.kind === "entries" ? run(id, menu.targets) : run(id, [], menu.folderId);

  const menuContent = (
    <ContextMenuContent>
      {menuActions.length > 0 ? (
        <EntryMenuItems actions={menuActions} onRun={runMenu} />
      ) : (
        <div className="px-2 py-1.5 text-xs text-ink-4">No actions</div>
      )}
    </ContextMenuContent>
  );

  // ── Context value ──────────────────────────────────────────────────

  const ctx: WorkspaceCtx = {
    perms,
    selection,
    select: (key, mods) => setSelectionState((s) => applyClick(s, key, order, mods)),
    setSelection: (keys) => setSelectionState({ keys: new Set(keys), anchor: keys[0] ?? null }),
    hidden,
    dragging,
    canDropOn,
    fileDropFolder,
    actionsFor: (targets) => entryActions(targets, perms),
    run: (id, targets) => run(id, targets),
  };

  // ── Dialog props ───────────────────────────────────────────────────

  const moveDialog = moveTargets && (() => {
    const fs = moveTargets.filter((t): t is FolderTarget => t.kind === "folder");
    const locations = new Set(moveTargets.map((t) => (t.kind === "doc" ? t.folderId : t.parentId)));
    const single = moveTargets.length === 1 ? moveTargets[0]! : null;
    return (
      <MoveToFolderDialog
        open
        onOpenChange={(o) => !o && setMoveTargets(null)}
        title={single ? `Move "${single.name}"` : `Move ${plural(moveTargets.length, "item")}`}
        description={
          fs.length
            ? "Pick where these should live. Folders move with everything inside them."
            : "Pick the folder these documents should live in."
        }
        folders={flat}
        disabledIds={fs.flatMap((f) => [f.id, ...collectDescendantIds(folders, f.id)])}
        currentFolderId={locations.size === 1 ? [...locations][0]! : undefined}
        warningLoader={visibilityWarnings ? (target) => moveVisibilityWarning(moveTargets, target) : undefined}
        onMove={(target) => moveTo(moveTargets, target)}
      />
    );
  })();

  const selectedActions = entryActions(selectedTargets, perms).filter((a) => BAR_ACTIONS.includes(a.id));
  const fileDropName = fileDropFolder === undefined ? null : folderName(fileDropFolder);

  return (
    <WorkspaceContext.Provider value={ctx}>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div
          className="relative p-5 flex flex-col lg:flex-row gap-5 items-start"
          onClickCapture={(e) => {
            if (Date.now() < suppressClickUntil.current) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          {...fileDragHandlers}
        >
          {/* ── Folder tree rail ─────────────────────────────────── */}
          <div className="w-full lg:w-60 shrink-0">
            <Card className="p-2">
              <ContextMenu>
                <ContextMenuTrigger onContextMenu={onTreeContextMenu}>
                  <FolderTree
                    scope={scope}
                    tree={tree}
                    counts={counts}
                    rootCount={rootCount}
                    selectedId={currentFolderId}
                  />
                </ContextMenuTrigger>
                {menuContent}
              </ContextMenu>
            </Card>
          </div>

          {/* ── Browser ──────────────────────────────────────────── */}
          <div className="flex-1 min-w-0 w-full flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <FolderBreadcrumbs basePath={basePath} folders={folders} currentFolderId={currentFolderId} />
              {toolbarNote}
              <div className="ml-auto flex items-center gap-2">
                {perms.writable && perms.folderCreate && !atDepthCap(currentFolderId) && (
                  <NewFolderButton
                    scope={scope}
                    parentId={currentFolderId}
                    parentName={currentFolderId ? folderName(currentFolderId) : null}
                  />
                )}
                {acceptsFiles && (
                  <MultiFileUpload
                    scope={scope}
                    folderId={currentFolderId}
                    folderName={currentFolderId ? folderName(currentFolderId) : null}
                    // Transport selector: local → streaming XHR route,
                    // vercel-blob → client-direct upload (client
                    // components can't read env, so the server decides).
                    storageDriver={storageDriver}
                    controlRef={uploadRef}
                  />
                )}
              </div>
            </div>

            {selectedTargets.length > 0 && (
              <div
                role="toolbar"
                aria-label="Selected items"
                className="sticky top-2 z-10 flex flex-wrap items-center gap-1 rounded-lg border border-brand-200 bg-brand-soft px-2 py-1.5 shadow-sm"
              >
                <button
                  type="button"
                  onClick={() => setSelectionState(EMPTY_SELECTION)}
                  aria-label="Clear selection"
                  className="inline-flex items-center justify-center w-7 h-7 rounded-md text-brand-700 hover:bg-brand-100"
                >
                  <X size={14} />
                </button>
                <span className="text-xs font-medium text-brand-700 mr-2">
                  {plural(selectedTargets.length, "item")} selected
                </span>
                {selectedActions.map((a) => {
                  const Icon = ACTION_ICONS[a.id];
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => run(a.id, selectedTargets)}
                      disabled={busy}
                      className={cn(
                        "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium disabled:opacity-50",
                        a.destructive ? "text-danger hover:bg-danger-soft" : "text-ink-2 hover:bg-white"
                      )}
                    >
                      <Icon size={13} />
                      {a.label}
                    </button>
                  );
                })}
              </div>
            )}

            <ContextMenu>
              <ContextMenuTrigger onContextMenu={onListContextMenu} className="flex flex-col gap-4 min-h-40">
                {rows.length === 0 ? (
                  empty
                ) : (
                  <Card className="p-0 overflow-hidden">
                    <DocumentsTable rows={rows} />
                  </Card>
                )}
              </ContextMenuTrigger>
              {menuContent}
            </ContextMenu>

            {children}
          </div>

          {fileDropName !== null && (
            <div className="pointer-events-none absolute inset-2 z-20 rounded-xl border-2 border-dashed border-brand-400 bg-brand-soft/30 flex items-end justify-center pb-6">
              <div className="inline-flex items-center gap-2 rounded-full bg-brand-700 px-4 py-2 text-xs font-medium text-white shadow-lg">
                <Upload size={13} />
                Drop to upload into {fileDropName}
              </div>
            </div>
          )}

          <input
            ref={pickerRef}
            type="file"
            multiple
            className="hidden"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length) uploadRef.current?.upload(files, pickerFolder.current);
            }}
          />
        </div>

        <DragOverlay dropAnimation={null}>
          {dragging && <DragChip targets={dragging.targets} />}
        </DragOverlay>
      </DndContext>

      {moveDialog}
      {copyTargets && (
        <MoveToFolderDialog
          open
          onOpenChange={(o) => !o && setCopyTargets(null)}
          title={copyTargets.length === 1 ? `Copy "${copyTargets[0]!.name}" to…` : `Copy ${plural(copyTargets.length, "file")} to…`}
          description={COPY_DESCRIPTION}
          folders={flat}
          currentFolderId={undefined}
          submitLabel="Copy here"
          pendingLabel="Copying…"
          onMove={(target) => copyTo(copyTargets, target)}
        />
      )}
      {editDoc && (
        <EditDocumentDialog
          open
          onOpenChange={(o) => !o && setEditDoc(null)}
          documentId={editDoc.id}
          name={editDoc.name}
          category={editDoc.category}
        />
      )}
      {renameTarget && (
        <RenameFolderDialog
          open
          onOpenChange={(o) => !o && setRenameTarget(null)}
          folderId={renameTarget.id}
          name={renameTarget.name}
        />
      )}
      {deleteEmail && (
        <DeleteDocumentDialog
          open
          onOpenChange={(o) => !o && setDeleteEmail(null)}
          documentId={deleteEmail.id}
          name={deleteEmail.name}
          unsavedAttachments={deleteEmail.unsavedAttachments}
          savedAttachments={deleteEmail.savedAttachments}
        />
      )}
      {newFolderParent !== undefined && (
        <NewFolderDialog
          open
          onOpenChange={(o) => !o && setNewFolderParent(undefined)}
          scope={scope}
          parentId={newFolderParent}
          parentName={newFolderParent ? folderName(newFolderParent) : null}
        />
      )}
    </WorkspaceContext.Provider>
  );
}

/** What follows the pointer during a drag. */
function DragChip({ targets }: { targets: ActionTarget[] }) {
  const first = targets[0];
  if (!first) return null;
  const Icon = first.kind === "folder" ? Folder : FileText;
  return (
    <div className="inline-flex items-center gap-2 rounded-md border border-brand-300 bg-white px-3 py-1.5 text-xs font-medium text-ink shadow-lg cursor-grabbing">
      <Icon size={13} className="text-ink-4" />
      <span className="max-w-60 truncate">{first.name}</span>
      {targets.length > 1 && (
        <span className="rounded-full bg-brand-700 px-1.5 text-2xs text-white">+{targets.length - 1}</span>
      )}
    </div>
  );
}
