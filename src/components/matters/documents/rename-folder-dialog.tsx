/**
 * Rename folder — small dialog with a name input (documents.folder.edit;
 * the server re-checks and enforces unique sibling names).
 */

"use client";

import { useState, useTransition } from "react";
import { TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { renameFolder } from "@/app/actions/document-folders";

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
          <DialogDescription>
            Folder names must be unique within their parent.
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
            value={newName}
            aria-label="Folder name"
            onChange={(e) => setNewName(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            maxLength={120}
            autoFocus
            className="h-8 px-2.5 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30"
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
              onClick={() => onOpenChange(false)}
              className="text-2xs text-ink-3 hover:text-ink-2 px-2"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending || newName.trim().length === 0}
              className={cn(
                "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium",
                "bg-brand-700 text-white hover:bg-brand-900 transition-colors",
                "disabled:opacity-60 disabled:cursor-not-allowed"
              )}
            >
              {pending ? "Renaming…" : "Rename"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
