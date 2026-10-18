/**
 * Document Row Actions — kebab menu next to each document row.
 *
 * Download (anchor to /api/documents/[id]/download?download=1 — saves
 * as an attachment — only when the row has a file) + "Move to…"
 * (documents.organize — re-files the document via the shared folder
 * picker; not offered for email attachments, which live under their
 * email) + "Also file in…" (documents.organize — the same document in
 * one more folder, ADR-043) + "Remove from this folder" on a row that
 * is such a link + Delete (uploader or documents.delete_any holder;
 * emails with attachments get a prompt about them).
 */

"use client";

import { useState, useTransition } from "react";
import {
  Download,
  FolderInput,
  FolderMinus,
  FolderPlus,
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
import { addDocumentLink, deleteDocument, removeDocumentLink } from "@/app/actions/documents";
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
  /** `documents.organize` flag — shows "Move to…" / "Also file in…". */
  canMove = false,
  /** Flattened folder tree for the pickers. */
  folders = [],
  /** Folder the document currently lives in (null = matter root). */
  currentFolderId = null,
  /** An email attachment: it lives under its email, so no "Move to…". */
  isAttachment = false,
  /** Other folders it's already filed in (its links). */
  alsoInFolderIds = [],
  /** Set when this row IS one of those links — offers "Remove from
   *  this folder" (the document itself stays). */
  linkId,
  /** For an email: attachments filed nowhere else / also filed elsewhere. */
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
  alsoInFolderIds?: (string | null)[];
  linkId?: string;
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
    const elsewhere = alsoInFolderIds.length;
    if (
      !confirm(
        `Delete "${name}"?\n\nThis can't be undone — the file is removed from the matter and from storage${
          elsewhere > 0 ? `, including the ${elsewhere} other folder${elsewhere === 1 ? "" : "s"} it's filed in` : ""
        }.`
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

  const onRemoveLink = () => {
    if (!linkId) return;
    startTransition(async () => {
      const result = await removeDocumentLink(linkId);
      if (!result.ok) alert(result.error ?? "Couldn't remove it from this folder.");
    });
  };

  if (!hasFile && !canMove && !canDelete) return null;
  const canRelocate = canMove && !isAttachment && !linkId;

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
              <FolderPlus />
              Also file in…
            </DropdownMenuItem>
          )}
          {canMove && linkId && (
            <DropdownMenuItem onClick={onRemoveLink}>
              <FolderMinus />
              Remove from this folder
            </DropdownMenuItem>
          )}
          {canDelete && (
            <>
              {(hasFile || canMove) && <DropdownMenuSeparator />}
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 />
                {linkId ? "Delete everywhere" : "Delete"}
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
          title={`Also file "${name}" in…`}
          description="The same document will also appear in that folder — one file, one set of flags. Removing it from a folder never deletes it."
          folders={folders}
          currentFolderId={isAttachment ? undefined : currentFolderId}
          alreadyIn={alsoInFolderIds}
          submitLabel="File here"
          pendingLabel="Filing…"
          onMove={(target) => addDocumentLink(documentId, target)}
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
          alsoInCount={alsoInFolderIds.length}
        />
      )}
    </>
  );
}
