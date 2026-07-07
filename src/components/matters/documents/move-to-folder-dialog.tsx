/**
 * Move to… — shared folder-picker dialog for the matter document
 * browser. Used by both re-file flows:
 *
 *   - moving documents into a folder (document kebab), and
 *   - moving a folder under a new parent (folder kebab, with the
 *     folder itself + its descendants disabled so a cycle can't even
 *     be picked — the server refuses regardless).
 *
 * Renders "All documents" (the matter root, target = null) followed
 * by the flattened tree, indented by depth. The caller passes an
 * async `onMove`; the dialog owns pending/error state and closes
 * itself on success (the action's revalidatePath refreshes the list).
 */

"use client";

import { useState, useTransition } from "react";
import { Folder, FolderInput, TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { FlatFolder } from "@/lib/folder-tree";

export function MoveToFolderDialog({
  open,
  onOpenChange,
  title,
  description,
  folders,
  disabledIds,
  currentFolderId,
  onMove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** Flattened tree (depth-first, 1-based depth) — drives indent. */
  folders: FlatFolder[];
  /** Unpickable targets (the moving folder + its descendants). */
  disabledIds?: string[];
  /** Where the item lives now — shown as "current", not pickable. */
  currentFolderId: string | null;
  onMove: (
    folderId: string | null
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [target, setTarget] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Reset per open so a stale pick/error never flashes (render-phase
  // reset — same pattern as GenerateFromTemplateDialog).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setTarget(undefined);
      setError(null);
    }
  }

  const disabled = new Set(disabledIds ?? []);

  const submit = () => {
    if (target === undefined) return;
    setError(null);
    startTransition(async () => {
      const res = await onMove(target);
      if (res.ok) onOpenChange(false);
      else setError(res.error ?? "Couldn't move — try again.");
    });
  };

  const option = (
    id: string | null,
    label: string,
    depth: number,
    isDisabled: boolean
  ) => {
    const isCurrent = id === currentFolderId;
    const isPicked = target !== undefined && target === id;
    return (
      <button
        key={id ?? "__root__"}
        type="button"
        disabled={isDisabled || isCurrent || pending}
        onClick={() => setTarget(id)}
        className={cn(
          "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left text-xs",
          isPicked
            ? "bg-brand-soft text-brand-700 font-medium"
            : "text-ink-2 hover:bg-paper-2",
          (isDisabled || isCurrent) &&
            "opacity-45 cursor-not-allowed hover:bg-transparent"
        )}
        style={{ paddingLeft: `${8 + (depth - 1) * 16}px` }}
      >
        <Folder size={13} className="shrink-0 text-ink-4" />
        <span className="truncate">{label}</span>
        {isCurrent && (
          <span className="ml-auto shrink-0 text-2xs font-mono text-ink-4">
            current
          </span>
        )}
      </button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-0.5 max-h-72 overflow-y-auto rounded-md border border-line bg-white p-1.5">
          {option(null, "All documents", 1, false)}
          {folders.map((f) =>
            option(f.id, f.name, f.depth + 1, disabled.has(f.id))
          )}
        </div>

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
            type="button"
            onClick={submit}
            disabled={pending || target === undefined}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium",
              "bg-brand-500 text-white hover:bg-brand-600 transition-colors",
              "disabled:opacity-60 disabled:cursor-not-allowed"
            )}
          >
            <FolderInput size={12} />
            {pending ? "Moving…" : "Move"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
