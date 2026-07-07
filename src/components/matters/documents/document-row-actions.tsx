/**
 * Document Row Actions — kebab menu next to each document row.
 *
 * Download (anchor to /api/documents/[id]/download, only when the row
 * has a file) + "Move to…" (documents.organize — re-files the
 * document via the shared folder picker) + Delete (uploader or
 * documents.delete_any holder, with confirm).
 */

"use client";

import { useState, useTransition } from "react";
import {
  Download,
  FolderInput,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteDocument } from "@/app/actions/documents";
import { moveDocuments } from "@/app/actions/document-folders";
import type { FlatFolder } from "@/lib/folder-tree";
import { MoveToFolderDialog } from "./move-to-folder-dialog";

export function DocumentRowActions({
  documentId,
  name,
  /** True when the current user is either the original uploader or
   *  holds `documents.delete_any` — only those two can delete. The
   *  server enforces the same check; this just hides the menu item
   *  to avoid a noisy "permission denied" alert. */
  canDelete,
  /** True when the row has a file blob — hides Download otherwise
   *  (seeded rows without bytes). */
  hasFile = true,
  /** `documents.organize` flag — shows "Move to…". */
  canMove = false,
  /** Flattened folder tree for the move picker. */
  folders = [],
  /** Folder the document currently lives in (null = matter root). */
  currentFolderId = null,
}: {
  documentId: string;
  name: string;
  canDelete: boolean;
  hasFile?: boolean;
  canMove?: boolean;
  folders?: FlatFolder[];
  currentFolderId?: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [moveOpen, setMoveOpen] = useState(false);

  const onDelete = () => {
    if (
      !confirm(
        `Delete "${name}"?\n\nThis can't be undone — the file is removed from the matter and from storage.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await deleteDocument(documentId);
      if (!result.ok) {
        alert(result.error ?? "Couldn't delete document.");
      }
    });
  };

  if (!hasFile && !canMove && !canDelete) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label="Document actions"
              disabled={pending}
              className="inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-4 hover:bg-paper-2 hover:text-ink disabled:opacity-50"
            >
              <MoreHorizontal size={14} />
            </button>
          }
        />
        <DropdownMenuContent align="end" className="min-w-44">
          {hasFile && (
            <DropdownMenuItem
              render={
                <a
                  href={`/api/documents/${documentId}/download`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download />
                  Download
                </a>
              }
            />
          )}
          {canMove && (
            <DropdownMenuItem onClick={() => setMoveOpen(true)}>
              <FolderInput />
              Move to…
            </DropdownMenuItem>
          )}
          {canDelete && (
            <>
              {(hasFile || canMove) && <DropdownMenuSeparator />}
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {canMove && (
        <MoveToFolderDialog
          open={moveOpen}
          onOpenChange={setMoveOpen}
          title={`Move "${name}"`}
          description="Pick the folder this document should live in."
          folders={folders}
          currentFolderId={currentFolderId}
          onMove={(target) => moveDocuments([documentId], target)}
        />
      )}
    </>
  );
}
