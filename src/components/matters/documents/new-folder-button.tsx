/**
 * New Folder — toolbar button + small dialog on the document browser.
 * Creates the folder INSIDE the currently selected folder (matter
 * root when "All documents" is selected). Renders only for holders
 * of `documents.folder.create` (page-level flag); the server
 * re-checks. The action's revalidatePath refreshes the tree + list.
 */

"use client";

import { useState, useTransition } from "react";
import { FolderPlus, TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { createFolder } from "@/app/actions/document-folders";

export function NewFolderButton({
  matterId,
  parentId,
  parentName,
}: {
  matterId: string;
  /** The currently browsed folder — null = matter root. */
  parentId: string | null;
  /** Display name for the dialog copy ("inside X"). */
  parentName: string | null;
}) {
  const [open, setOpen] = useState(false);
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
      const res = await createFolder(matterId, parentId, name);
      if (res.ok) setOpen(false);
      else setError(res.error);
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-1.5 h-8 px-3 text-xs",
          "rounded-md border border-line bg-white",
          "hover:border-brand-300 hover:text-brand-700 transition-colors text-ink-2"
        )}
      >
        <FolderPlus size={13} />
        New folder
      </button>

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
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Production 1 — APD records"
              maxLength={120}
              autoFocus
              className="h-8 px-2.5 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 placeholder:text-ink-4"
            />
            {error && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-warn-soft border border-warn-border text-2xs text-warn">
                <TriangleAlert size={12} className="shrink-0 mt-px" />
                <span>{error}</span>
              </div>
            )}
            <DialogFooter>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-2xs text-ink-3 hover:text-ink-2 px-2"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending || name.trim().length === 0}
                className={cn(
                  "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium",
                  "bg-brand-500 text-white hover:bg-brand-600 transition-colors",
                  "disabled:opacity-60 disabled:cursor-not-allowed"
                )}
              >
                <FolderPlus size={12} />
                {pending ? "Creating…" : "Create"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
