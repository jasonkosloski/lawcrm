/**
 * Delete prompt for a document that has email attachments (ADR-043).
 *
 * Attachments that have been copied to another folder ("saved") live on
 * as those copies — the prompt just says so. Attachments that exist
 * only under the email are listed, and the user picks whether they go
 * with the email (default) or stay in the folder as ordinary
 * documents. The choice is sent to `deleteDocument` explicitly; the
 * server refuses to guess.
 */

"use client";

import { useState, useTransition } from "react";
import { Paperclip, Trash2, TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { deleteDocument, type AttachmentChoice } from "@/app/actions/documents";
import { Button } from "@/components/ui/button";

export function DeleteDocumentDialog({
  open,
  onOpenChange,
  documentId,
  name,
  unsavedAttachments,
  savedAttachments,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  name: string;
  /** Attachments with no copy anywhere else. */
  unsavedAttachments: string[];
  /** Attachments copied to another folder — the copies stay. */
  savedAttachments: string[];
}) {
  const [choice, setChoice] = useState<AttachmentChoice>("delete");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setChoice("delete");
      setError(null);
    }
  }

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await deleteDocument(
        documentId,
        unsavedAttachments.length ? { attachments: choice } : {},
      );
      if (res.ok) onOpenChange(false);
      else setError(res.error ?? "Couldn't delete the document.");
    });
  };

  const n = unsavedAttachments.length;
  const option = (value: AttachmentChoice, label: string, hint: string) => (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-xs",
        choice === value ? "border-brand-300 bg-brand-soft" : "border-line bg-white",
      )}
    >
      <input
        type="radio"
        name="attachment-choice"
        value={value}
        checked={choice === value}
        onChange={() => setChoice(value)}
        className="mt-0.5"
      />
      <span>
        <span className="block font-medium text-ink">{label}</span>
        <span className="block text-2xs text-ink-3">{hint}</span>
      </span>
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete “{name}”?</DialogTitle>
          <DialogDescription>
            This can&apos;t be undone. Copies in other folders are separate documents and
            aren&apos;t affected.
          </DialogDescription>
        </DialogHeader>

        {n > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-xs text-ink-2">
              {n === 1 ? "This attachment hasn't" : `These ${n} attachments haven't`} been copied
              anywhere else:
            </div>
            <ul className="flex max-h-32 flex-col gap-0.5 overflow-y-auto rounded-md border border-line bg-paper-2 p-2">
              {unsavedAttachments.map((a, i) => (
                <li key={i} className="flex items-center gap-1.5 text-2xs text-ink-2">
                  <Paperclip className="h-3 w-3 shrink-0 text-ink-4" aria-hidden />
                  <span className="truncate">{a}</span>
                </li>
              ))}
            </ul>
            {option(
              "delete",
              n === 1 ? "Delete it with the email" : "Delete them with the email",
              "Removed along with the email.",
            )}
            {option(
              "keep",
              n === 1 ? "Keep it in this folder" : "Keep them in this folder",
              "They stay as ordinary documents, with their flags.",
            )}
          </div>
        )}

        {savedAttachments.length > 0 && (
          <div className="text-2xs text-ink-3">
            {savedAttachments.length === 1
              ? `“${savedAttachments[0]}” has a copy in another folder — that copy stays.`
              : `${savedAttachments.length} attachments have copies in other folders — those copies stay.`}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-warn-border bg-warn-soft px-3 py-2 text-2xs text-warn">
            <TriangleAlert size={12} className="mt-px shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="bg-danger text-white hover:bg-danger/90"
            type="button"
            onClick={submit}
            disabled={pending}
          >
            <Trash2 size={12} />
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
