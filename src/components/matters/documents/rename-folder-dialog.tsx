/**
 * Rename folder — small dialog with a name input (documents.folder.edit;
 * the server re-checks and enforces unique sibling names).
 */

"use client";

import { useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { renameFolder } from "@/app/actions/document-folders";
import { inputClass, FormErrorBanner } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export function RenameFolderDialog({
  open,
  onOpenChange,
  folderId,
  name,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId: string;
  name: string;
}) {
  const [newName, setNewName] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Fresh name + clean error each time the dialog opens.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setNewName(name);
      setError(null);
    }
  }

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await renameFolder(folderId, newName);
      if (res.ok) onOpenChange(false);
      else setError(res.error);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename folder</DialogTitle>
          <DialogDescription>Folder names must be unique within their parent.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex flex-col gap-3"
        >
          <input
            type="text"
            value={newName}
            aria-label="Folder name"
            onChange={(e) => setNewName(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            maxLength={120}
            autoFocus
            className={inputClass()}
          />
          <FormErrorBanner message={error} />
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || newName.trim().length === 0}>
              {pending ? "Renaming…" : "Rename"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
