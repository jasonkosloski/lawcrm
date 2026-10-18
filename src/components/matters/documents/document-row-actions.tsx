/**
 * Document Row Actions — kebab menu next to each document row.
 *
 * Download (anchor to /api/documents/[id]/download?download=1 — saves
 * as an attachment — only when the row has a file) + "Move to…"
 * (documents.organize — re-files the document via the shared folder
 * picker; not offered for email attachments, which live under their
 * email) + "Copy to…" (documents.organize — an independent copy in
 * another folder that shares the stored file, ADR-043) + Delete
 * (uploader or documents.delete_any holder; emails with attachments
 * get a prompt about them).
 */

"use client";

import { useState, useTransition } from "react";
import { Copy, Download, FolderInput, MoreHorizontal, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { copyDocumentToFolder, deleteDocument } from "@/app/actions/documents";
import { COPY_DESCRIPTION } from "@/components/documents-viewer/document-placement";
import { moveDocuments } from "@/app/actions/document-folders";
import type { FlatFolder } from "@/lib/folder-tree";
import { MoveToFolderDialog } from "./move-to-folder-dialog";
import { DeleteDocumentDialog } from "./delete-document-dialog";

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
  /** `documents.organize` flag — shows "Move to…" / "Copy to…". */
  canMove = false,
  /** Flattened folder tree for the pickers. */
  folders = [],
  /** Folder the document currently lives in (null = matter root). */
  currentFolderId = null,
  /** An email attachment: it lives under its email, so no "Move to…". */
  isAttachment = false,
  /** For an email: attachments with no copy elsewhere / with one. */
  unsavedAttachments = [],
  savedAttachments = [],
}: {
  documentId: string;
  name: string;
  canDelete: boolean;
  hasFile?: boolean;
  canMove?: boolean;
  folders?: FlatFolder[];
  currentFolderId?: string | null;
  isAttachment?: boolean;
  unsavedAttachments?: string[];
  savedAttachments?: string[];
}) {
  const [pending, startTransition] = useTransition();
  const [moveOpen, setMoveOpen] = useState(false);
  const [fileOpen, setFileOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const hasAttachments = unsavedAttachments.length + savedAttachments.length > 0;

  const onDelete = () => {
    if (hasAttachments) {
      setDeleteOpen(true);
      return;
    }
    if (
      !confirm(
        `Delete "${name}"?\n\nThis can't be undone. Copies of it in other folders are separate documents and aren't affected.`
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
  const canRelocate = canMove && !isAttachment;

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
        <DropdownMenuContent align="end" className="min-w-48">
          {hasFile && (
            <DropdownMenuItem
              render={
                // ?download=1 → Content-Disposition: attachment, so
                // PDFs/media save to disk instead of opening in a tab
                // (opening is what the row link / viewer are for).
                <a href={`/api/documents/${documentId}/download?download=1`}>
                  <Download />
                  Download
                </a>
              }
            />
          )}
          {canRelocate && (
            <DropdownMenuItem onClick={() => setMoveOpen(true)}>
              <FolderInput />
              Move to…
            </DropdownMenuItem>
          )}
          {canMove && (
            <DropdownMenuItem onClick={() => setFileOpen(true)}>
              <Copy />
              Copy to…
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

      {canRelocate && (
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
      {canMove && (
        <MoveToFolderDialog
          open={fileOpen}
          onOpenChange={setFileOpen}
          title={`Copy "${name}" to…`}
          description={COPY_DESCRIPTION}
          folders={folders}
          currentFolderId={undefined}
          submitLabel="Copy here"
          pendingLabel="Copying…"
          onMove={(target) => copyDocumentToFolder(documentId, target)}
        />
      )}
      {hasAttachments && (
        <DeleteDocumentDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          documentId={documentId}
          name={name}
          unsavedAttachments={unsavedAttachments}
          savedAttachments={savedAttachments}
        />
      )}
    </>
  );
}
