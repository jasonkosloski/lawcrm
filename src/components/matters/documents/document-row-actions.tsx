/**
 * Document Row Actions — kebab menu next to each document row.
 *
 * Download (anchor to /api/documents/[id]/download?download=1 — saves
 * as an attachment — only when the row has a file) + "Move to…"
 * (documents.organize — re-files the document via the shared folder
 * picker; not offered for email attachments, which live under their
 * email) + "Copy to…" (documents.organize — an independent copy in
 * another folder that shares the stored file, ADR-043) + "Edit
 * details…" (documents.edit — rename / re-categorize) + Delete
 * (uploader or documents.delete_any holder; emails with attachments
 * get a prompt about them).
 */

"use client";

import { useState, useTransition } from "react";
import { Copy, Download, Eye, EyeOff, FolderInput, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
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
import { setDocumentsClientShare } from "@/app/actions/portal-documents";
import { moveWarning } from "@/lib/portal/move-warning";
import type { FlatFolder } from "@/lib/folder-tree";
import { confirmAction, notifyError } from "@/lib/feedback";
import { MoveToFolderDialog } from "./move-to-folder-dialog";
import { DeleteDocumentDialog } from "./delete-document-dialog";
import { EditDocumentDialog } from "./edit-document-dialog";

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
  canShare = false,
  /** `documents.edit` flag — shows "Edit details…". */
  canEdit = false,
  category = "other",
  isShared = false,
  clientShare = null,
  status,
  attachmentShares = [],
  visibilityFolders,
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
  /** portal.share_documents on a matter document (never leads). */
  canShare?: boolean;
  canEdit?: boolean;
  /** Current category (prefills the edit dialog). */
  category?: string;
  /** Effectively visible to the client right now. */
  isShared?: boolean;
  /** The document's own override, for the move warning. */
  clientShare?: string | null;
  /** Document status; an archived file never counts in the move warning. */
  status?: string;
  /** An email's extracted attachments: moving the email moves them
   *  too, so the move warning counts them. */
  attachmentShares?: { clientShare: string | null; folderId: string | null; status: string }[];
  /** Folder share flags; when given, the move dialog warns on a
   *  client-visibility change. */
  visibilityFolders?: { id: string; parentId: string | null; clientShared: boolean }[];
}) {
  const [pending, startTransition] = useTransition();
  const [moveOpen, setMoveOpen] = useState(false);
  const [fileOpen, setFileOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const hasAttachments = unsavedAttachments.length + savedAttachments.length > 0;

  const onDelete = async () => {
    if (hasAttachments) {
      setDeleteOpen(true);
      return;
    }
    if (
      !(await confirmAction({
        title: `Delete "${name}"?`,
        description:
          "This can't be undone. Copies of it in other folders are separate documents and aren't affected.",
        confirmLabel: "Delete document",
        destructive: true,
      }))
    ) {
      return;
    }
    startTransition(async () => {
      const result = await deleteDocument(documentId);
      if (!result.ok) {
        notifyError(result.error ?? "Couldn't delete document.");
      }
    });
  };

  const onToggleShare = () => {
    startTransition(async () => {
      const result = await setDocumentsClientShare([documentId], !isShared);
      if (!result.ok) notifyError(result.error ?? "Couldn't update sharing.");
    });
  };

  if (!hasFile && !canMove && !canDelete && !canShare && !canEdit) return null;
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
          {canEdit && (
            <DropdownMenuItem onClick={() => setEditOpen(true)}>
              <Pencil />
              Edit details…
            </DropdownMenuItem>
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
          {canShare && (
            <DropdownMenuItem onClick={onToggleShare}>
              {isShared ? <EyeOff /> : <Eye />}
              {isShared ? "Stop sharing" : "Share with client"}
            </DropdownMenuItem>
          )}
          {canDelete && (
            <>
              {(hasFile || canMove || canShare || canEdit) && <DropdownMenuSeparator />}
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {canEdit && (
        <EditDocumentDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          documentId={documentId}
          name={name}
          category={category}
        />
      )}
      {canRelocate && (
        <MoveToFolderDialog
          open={moveOpen}
          onOpenChange={setMoveOpen}
          title={`Move "${name}"`}
          description="Pick the folder this document should live in."
          folders={folders}
          currentFolderId={currentFolderId}
          warningFor={
            visibilityFolders
              ? (target) =>
                  moveWarning(
                    [{ clientShare, folderId: currentFolderId, status }, ...attachmentShares],
                    target,
                    visibilityFolders
                  )
              : undefined
          }
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
