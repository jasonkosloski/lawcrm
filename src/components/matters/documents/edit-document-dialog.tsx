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
import { Pencil } from "lucide-react";
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
import { inputClass, FormErrorBanner } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

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
            Change this document&apos;s display name or category. The file itself isn&apos;t
            changed.
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
              className={inputClass()}
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
                <NativeSelectOption value={category}>
                  {documentCategoryLabel(category)}
                </NativeSelectOption>
              )}
              {DOCUMENT_CATEGORIES.map((c: DocumentCategory) => (
                <NativeSelectOption key={c} value={c}>
                  {DOCUMENT_CATEGORY_LABEL[c]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <FormErrorBanner message={error} />
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || unchanged || newName.trim().length === 0}>
              {pending ? "Saving…" : "Save"}
            </Button>
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
      <Button variant="outline" size="xs" type="button" onClick={() => setOpen(true)}>
        <Pencil className="h-3.5 w-3.5" aria-hidden />
        Edit details
      </Button>
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
