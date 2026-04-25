/**
 * Document Row Actions — kebab menu next to each document row.
 *
 * Today: Download (anchor to /api/documents/[id]/download) + Delete
 * (action with confirm). When preview lands it slots in between the
 * two — a modal/page rendering inline PDFs without forcing a save.
 */

"use client";

import { useTransition } from "react";
import { Download, MoreHorizontal, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteDocument } from "@/app/actions/documents";

export function DocumentRowActions({
  documentId,
  name,
  /** True when the current user is either the original uploader or
   *  a firm admin — only those two can delete. The server enforces
   *  the same check; this just hides the menu item to avoid a
   *  noisy "permission denied" alert. */
  canDelete,
}: {
  documentId: string;
  name: string;
  canDelete: boolean;
}) {
  const [pending, startTransition] = useTransition();

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

  return (
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
        {canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
