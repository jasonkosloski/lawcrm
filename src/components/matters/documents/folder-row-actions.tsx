/**
 * Folder Row Actions — kebab menu on a folder row in the document
 * browser.
 *
 * Rename (documents.folder.edit) → small dialog with a name input.
 * Move to… (documents.organize) → shared folder picker, with the
 *   folder itself + its descendants disabled (cycle prevention; the
 *   server re-checks).
 * Delete (documents.folder.delete) → confirm(). Deleting never
 *   deletes files: contents re-parent to the folder's parent, name
 *   collisions get a " (2)"-style suffix (see the action header).
 *
 * The menu itself renders only when the caller holds at least one of
 * the three flags — the server enforces each regardless.
 */

"use client";

import { useState, useTransition } from "react";
import {
  FolderInput,
  MoreHorizontal,
  Pencil,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  deleteFolder,
  moveFolder,
  renameFolder,
} from "@/app/actions/document-folders";
import { collectDescendantIds, type FlatFolder } from "@/lib/folder-tree";
import { MoveToFolderDialog } from "./move-to-folder-dialog";

export function FolderRowActions({
  folderId,
  name,
  parentId,
  folders,
  canEdit,
  canDelete,
  canOrganize,
}: {
  folderId: string;
  name: string;
  /** Current parent — the picker marks it "current". */
  parentId: string | null;
  /** The matter's whole flattened tree (for the move picker). */
  folders: FlatFolder[];
  canEdit: boolean;
  canDelete: boolean;
  canOrganize: boolean;
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [newName, setNewName] = useState(name);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Fresh name + clean error each time the rename dialog opens.
  const [prevRenameOpen, setPrevRenameOpen] = useState(renameOpen);
  if (renameOpen !== prevRenameOpen) {
    setPrevRenameOpen(renameOpen);
    if (renameOpen) {
      setNewName(name);
      setRenameError(null);
    }
  }

  if (!canEdit && !canDelete && !canOrganize) return null;

  const submitRename = () => {
    setRenameError(null);
    startTransition(async () => {
      const res = await renameFolder(folderId, newName);
      if (res.ok) setRenameOpen(false);
      else setRenameError(res.error);
    });
  };

  const onDelete = () => {
    if (
      !confirm(
        `Delete the folder "${name}"?\n\nNothing inside is deleted — its subfolders and files move up one level.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await deleteFolder(folderId);
      if (!res.ok) alert(res.error ?? "Couldn't delete folder.");
    });
  };

  // The folder can't move into itself or its own subtree.
  const disabledIds = [
    folderId,
    ...collectDescendantIds(folders, folderId),
  ];

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label="Folder actions"
              disabled={pending}
              className="inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-4 hover:bg-paper-2 hover:text-ink disabled:opacity-50"
            >
              <MoreHorizontal size={14} />
            </button>
          }
        />
        <DropdownMenuContent align="end" className="min-w-44">
          {canEdit && (
            <DropdownMenuItem onClick={() => setRenameOpen(true)}>
              <Pencil />
              Rename
            </DropdownMenuItem>
          )}
          {canOrganize && (
            <DropdownMenuItem onClick={() => setMoveOpen(true)}>
              <FolderInput />
              Move to…
            </DropdownMenuItem>
          )}
          {canDelete && (
            <>
              {(canEdit || canOrganize) && <DropdownMenuSeparator />}
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename folder</DialogTitle>
            <DialogDescription>
              Folder names must be unique within their parent.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitRename();
            }}
            className="flex flex-col gap-3"
          >
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={120}
              autoFocus
              className="h-8 px-2.5 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30"
            />
            {renameError && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-warn-soft border border-warn-border text-2xs text-warn">
                <TriangleAlert size={12} className="shrink-0 mt-px" />
                <span>{renameError}</span>
              </div>
            )}
            <DialogFooter>
              <button
                type="button"
                onClick={() => setRenameOpen(false)}
                className="text-2xs text-ink-3 hover:text-ink-2 px-2"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending || newName.trim().length === 0}
                className={cn(
                  "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium",
                  "bg-brand-500 text-white hover:bg-brand-600 transition-colors",
                  "disabled:opacity-60 disabled:cursor-not-allowed"
                )}
              >
                {pending ? "Renaming…" : "Rename"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <MoveToFolderDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        title={`Move "${name}"`}
        description="Pick where this folder (and everything inside it) should live."
        folders={folders}
        disabledIds={disabledIds}
        currentFolderId={parentId}
        onMove={(target) => moveFolder(folderId, target)}
      />
    </>
  );
}
