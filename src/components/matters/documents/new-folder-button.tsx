/**
 * New Folder — toolbar button + small dialog on the document browser.
 * Creates the folder INSIDE the currently selected folder (matter
 * root when "All documents" is selected). Renders only for holders
 * of `documents.folder.create` (page-level flag); the server
 * re-checks. The action's revalidatePath refreshes the tree + list.
 */

"use client";

import type { RecordScope } from "@/lib/record-scope";
import { useState, useTransition } from "react";
import { FolderPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createFolder } from "@/app/actions/document-folders";
import { inputClass, FormErrorBanner } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export function NewFolderButton({
  scope,
  parentId,
  parentName,
}: {
  scope: RecordScope;
  /** The currently browsed folder — null = matter root. */
  parentId: string | null;
  /** Display name for the dialog copy ("inside X"). */
  parentName: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        type="button"
        onClick={() => setOpen(true)}
      >
        <FolderPlus size={13} />
        New folder
      </Button>
      <NewFolderDialog
        open={open}
        onOpenChange={setOpen}
        scope={scope}
        parentId={parentId}
        parentName={parentName}
      />
    </>
  );
}

/** The create dialog on its own — the document browser's right-click
 *  menu opens it for any folder. */
export function NewFolderDialog({
  open,
  onOpenChange: setOpen,
  scope,
  parentId,
  parentName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: RecordScope;
  parentId: string | null;
  parentName: string | null;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setName("");
      setError(null);
    }
  }

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await createFolder(scope, parentId, name);
      if (res.ok) setOpen(false);
      else setError(res.error);
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription>
              Created inside{" "}
              <span className="font-medium text-ink-2">
                {parentName ?? "All documents"}
              </span>
              . Names must be unique within their parent.
            </DialogDescription>
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
              value={name}
              aria-label="Folder name"
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Production 1 — APD records"
              maxLength={120}
              autoFocus
              className={inputClass()}
            />
            <FormErrorBanner message={error} />
            <DialogFooter>
              <Button
                variant="outline"
                type="button"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={pending || name.trim().length === 0}
              >
                <FolderPlus size={12} />
                {pending ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
