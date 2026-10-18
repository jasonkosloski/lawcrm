/**
 * The viewer header's placement line (ADR-043):
 *   - "Attachment of <email>" for a file extracted from an email,
 *   - "Copy to…" (documents.organize): an independent copy in another
 *     folder — its own document from then on, sharing the stored file.
 * Plus ExtractAttachmentsButton for emails uploaded before attachments
 * were extracted automatically.
 */

"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Paperclip } from "lucide-react";
import { copyDocumentToFolder, extractAttachments } from "@/app/actions/documents";
import { MoveToFolderDialog } from "@/components/matters/documents/move-to-folder-dialog";
import type { FlatFolder } from "@/lib/folder-tree";

export const COPY_DESCRIPTION =
  "Makes a separate copy in that folder — its own document, with its own name, flags and notes. The file isn't uploaded again.";

export function DocumentPlacement({
  matterId,
  documentId,
  name,
  parent,
  folders,
  canOrganize,
}: {
  matterId: string;
  documentId: string;
  name: string;
  parent: { id: string; name: string } | null;
  folders: FlatFolder[];
  canOrganize: boolean;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  if (!parent && !canOrganize) return null;

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
      {canOrganize && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-1.5 py-0.5 text-ink-3 hover:border-brand-300 hover:text-brand-700"
        >
          <Copy className="h-3 w-3" aria-hidden />
          Copy to…
        </button>
      )}
      {canOrganize && (
        <MoveToFolderDialog
          open={open}
          onOpenChange={setOpen}
          title={`Copy "${name}" to…`}
          description={COPY_DESCRIPTION}
          folders={folders}
          currentFolderId={undefined}
          submitLabel="Copy here"
          pendingLabel="Copying…"
          onMove={async (target) => {
            const res = await copyDocumentToFolder(documentId, target);
            // Open the new copy — it's its own document from here on.
            if (res.ok && res.id) router.push(`/matters/${matterId}/documents/${res.id}`);
            return res;
          }}
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
