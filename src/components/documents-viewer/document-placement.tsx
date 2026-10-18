/**
 * Where this document is filed, in the viewer's header (ADR-043):
 *   - "Attachment of <email>" for a file extracted from an email,
 *   - "Also in" chips for the other folders it's filed in (each with a
 *     remove button for documents.organize holders — removing a place
 *     never deletes the document),
 *   - "Also file in…" to add it to one more folder.
 * Plus ExtractAttachmentsButton for emails uploaded before attachments
 * were extracted automatically.
 */

"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { FolderPlus, Paperclip, X } from "lucide-react";
import { addDocumentLink, extractAttachments, removeDocumentLink } from "@/app/actions/documents";
import { MoveToFolderDialog } from "@/components/matters/documents/move-to-folder-dialog";
import type { FlatFolder } from "@/lib/folder-tree";

export function DocumentPlacement({
  matterId,
  documentId,
  name,
  folderId,
  parent,
  alsoIn,
  folders,
  canOrganize,
}: {
  matterId: string;
  documentId: string;
  name: string;
  folderId: string | null;
  parent: { id: string; name: string } | null;
  alsoIn: { linkId: string; folderId: string | null; folderName: string }[];
  folders: FlatFolder[];
  canOrganize: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!parent && alsoIn.length === 0 && !canOrganize) return null;

  const remove = (linkId: string) => {
    setError(null);
    startTransition(async () => {
      const res = await removeDocumentLink(linkId);
      if (!res.ok) setError(res.error ?? "Couldn't remove it from that folder.");
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-2xs text-ink-4">
      {parent && (
        <span className="inline-flex items-center gap-1">
          <Paperclip className="h-3 w-3" aria-hidden />
          Attachment of{" "}
          <Link href={`/matters/${matterId}/documents/${parent.id}`} className="text-brand-700 hover:underline">
            {parent.name}
          </Link>
        </span>
      )}
      {alsoIn.length > 0 && (
        <span className="inline-flex flex-wrap items-center gap-1">
          {parent && <span aria-hidden>·</span>}
          Also in
          {alsoIn.map((f) => (
            <span
              key={f.linkId}
              className="inline-flex items-center gap-0.5 rounded-full border border-line bg-white py-0.5 pl-2 pr-1 text-ink-3"
            >
              <Link
                href={f.folderId ? `/matters/${matterId}/documents?folder=${f.folderId}` : `/matters/${matterId}/documents`}
                className="hover:text-brand-700"
              >
                {f.folderName}
              </Link>
              {canOrganize && (
                <button
                  type="button"
                  onClick={() => remove(f.linkId)}
                  disabled={pending}
                  aria-label={`Remove from ${f.folderName}`}
                  title={`Remove from ${f.folderName} (the document stays)`}
                  className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-ink-4 hover:bg-paper-2 hover:text-ink"
                >
                  <X className="h-2.5 w-2.5" aria-hidden />
                </button>
              )}
            </span>
          ))}
        </span>
      )}
      {canOrganize && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-1.5 py-0.5 text-ink-3 hover:border-brand-300 hover:text-brand-700"
        >
          <FolderPlus className="h-3 w-3" aria-hidden />
          Also file in…
        </button>
      )}
      {error && (
        <span role="alert" className="text-warn">
          {error}
        </span>
      )}
      {canOrganize && (
        <MoveToFolderDialog
          open={open}
          onOpenChange={setOpen}
          title={`Also file "${name}" in…`}
          description="The same document will also appear in that folder — one file, one set of flags. Removing it from a folder never deletes it."
          folders={folders}
          currentFolderId={parent ? undefined : folderId}
          alreadyIn={alsoIn.map((f) => f.folderId)}
          submitLabel="File here"
          pendingLabel="Filing…"
          onMove={(target) => addDocumentLink(documentId, target)}
        />
      )}
    </div>
  );
}

/** For an email whose attachments haven't been extracted yet. */
export function ExtractAttachmentsButton({ documentId, count }: { documentId: string; count: number }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await extractAttachments(documentId);
            // Success re-renders the page (the action revalidates it).
            if (!res.ok) setError(res.error ?? "Couldn't add the attachments.");
          })
        }
        className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2 py-0.5 text-2xs font-medium text-ink-2 hover:border-brand-300 hover:text-brand-700 disabled:opacity-60"
      >
        <Paperclip className="h-3 w-3" aria-hidden />
        {pending ? "Adding…" : `Add ${count === 1 ? "attachment" : `${count} attachments`} to documents`}
      </button>
      {error && (
        <span role="alert" className="text-2xs text-warn">
          {error}
        </span>
      )}
    </span>
  );
}
