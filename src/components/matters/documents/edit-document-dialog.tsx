/**
 * Edit details — rename a document and change its category
 * (`documents.edit`, enforced by `updateDocumentMetadata`; callers
 * only render this for holders). Metadata only: the stored file is
 * never touched.
 *
 * `EditDocumentDialog` is the controlled dialog (used from the row
 * kebab); `EditDocumentButton` pairs it with its own trigger for the
 * viewer header.
 */

"use client";

import { useState, useTransition } from "react";
import { Pencil, TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { updateDocumentMetadata } from "@/app/actions/documents";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABEL,
  type DocumentCategory,
} from "@/lib/document-form";
import { documentCategoryLabel } from "@/lib/document-display";
import { MAX_DOCUMENT_NAME_LENGTH } from "@/app/api/documents/upload/upload-config";
import { cn } from "@/lib/utils";

export function EditDocumentDialog({
  open,
  onOpenChange,
  documentId,
  name,
  category,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  name: string;
  category: string;
}) {
  const [newName, setNewName] = useState(name);
  const [newCategory, setNewCategory] = useState(category);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Fresh values + clean error each time the dialog opens (render-phase
  // reset — same pattern as the folder rename dialog).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setNewName(name);
      setNewCategory(category);
      setError(null);
    }
  }

  const known = (DOCUMENT_CATEGORIES as readonly string[]).includes(category);
  const unchanged = newName.trim() === name && newCategory === category;

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await updateDocumentMetadata(documentId, {
        name: newName,
        category: newCategory,
      });
      if (res.ok) onOpenChange(false);
      else setError(res.error ?? "Couldn't save — try again.");
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit details</DialogTitle>
          <DialogDescription>
            Change this document&apos;s display name or category. The file
            itself isn&apos;t changed.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!unchanged) submit();
          }}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="edit-doc-name" className="text-2xs font-medium text-ink-3">
              Name
            </label>
            <input
              id="edit-doc-name"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={MAX_DOCUMENT_NAME_LENGTH}
              autoFocus
              className="h-8 px-2.5 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="edit-doc-category" className="text-2xs font-medium text-ink-3">
              Category
            </label>
            <NativeSelect
              id="edit-doc-category"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              className="w-full"
            >
              {!known && (
                <NativeSelectOption value={category}>{documentCategoryLabel(category)}</NativeSelectOption>
              )}
              {DOCUMENT_CATEGORIES.map((c: DocumentCategory) => (
                <NativeSelectOption key={c} value={c}>
                  {DOCUMENT_CATEGORY_LABEL[c]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 px-3 py-2 rounded-md bg-warn-soft border border-warn-border text-2xs text-warn"
            >
              <TriangleAlert size={12} className="shrink-0 mt-px" />
              <span>{error}</span>
            </div>
          )}
          <DialogFooter>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="text-2xs text-ink-3 hover:text-ink-2 px-2"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending || unchanged || newName.trim().length === 0}
              className={cn(
                "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium",
                "bg-brand-700 text-white hover:bg-brand-900 transition-colors",
                "disabled:opacity-60 disabled:cursor-not-allowed"
              )}
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Viewer-header trigger + dialog. The action revalidates the viewer
 *  path, so the server-rendered header updates on save. */
export function EditDocumentButton({
  documentId,
  name,
  category,
}: {
  documentId: string;
  name: string;
  category: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-white px-2.5 text-xs font-medium text-ink-2 transition-colors hover:border-brand-300 hover:text-brand-700"
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden />
        Edit details
      </button>
      <EditDocumentDialog
        open={open}
        onOpenChange={setOpen}
        documentId={documentId}
        name={name}
        category={category}
      />
    </>
  );
}
