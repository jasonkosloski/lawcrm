/**
 * Saved-search strip — one chip per saved row, shown under the
 * query input whenever the user has any.
 *
 * Each chip links to /search?q=…[&type=…]; the kebab at its right
 * edge (revealed on hover/focus, always present for touch) offers
 * Rename (small dialog) and Delete (confirm()). Mutations go through
 * the identity-scoped actions in app/actions/saved-searches.ts,
 * which revalidate /search so the server-rendered strip refreshes.
 */

"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Bookmark, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  deleteSavedSearch,
  renameSavedSearch,
} from "@/app/actions/saved-searches";
import type { SavedSearchRow } from "@/lib/queries/saved-searches";
import { TYPE_META } from "./search-results";

function savedSearchHref(row: SavedSearchRow): string {
  const base = `/search?q=${encodeURIComponent(row.q)}`;
  return row.type ? `${base}&type=${row.type}` : base;
}

export function SavedSearchChips({
  rows,
  activeId,
}: {
  rows: SavedSearchRow[];
  /** Saved row matching the page's current (q, type), if any —
   *  highlighted so "where am I" stays legible. */
  activeId: string | null;
}) {
  return (
    <section aria-label="Saved searches" className="flex flex-col gap-1.5">
      <div className="text-2xs font-mono uppercase tracking-wider text-ink-4 px-1">
        Saved
      </div>
      <div className="flex flex-wrap gap-1.5">
        {rows.map((row) => (
          <SavedSearchChip
            key={row.id}
            row={row}
            active={row.id === activeId}
          />
        ))}
      </div>
    </section>
  );
}

function SavedSearchChip({
  row,
  active,
}: {
  row: SavedSearchRow;
  active: boolean;
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const onDelete = () => {
    if (!confirm(`Delete the saved search "${row.name}"?`)) return;
    startTransition(async () => {
      const res = await deleteSavedSearch(row.id);
      if (!res.ok) alert(res.error);
    });
  };

  return (
    <div
      className={cn(
        "group inline-flex items-center gap-0.5 rounded-full border pl-2.5 pr-1 py-1 text-xs transition-colors",
        pending && "opacity-50",
        active
          ? "border-brand-300 bg-brand-50 text-brand-700"
          : "border-line-2 bg-white text-ink-2 hover:border-brand-300"
      )}
    >
      <Link
        href={savedSearchHref(row)}
        className="inline-flex items-center gap-1.5 min-w-0 hover:text-brand-700 transition-colors"
      >
        <Bookmark size={11} className="shrink-0 text-ink-4" />
        <span className="truncate max-w-48">{row.name}</span>
        {row.type && (
          <span className="shrink-0 font-mono text-2xs text-ink-4">
            {TYPE_META[row.type].label.toLowerCase()}
          </span>
        )}
      </Link>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label={`Actions for saved search "${row.name}"`}
              disabled={pending}
              className="inline-flex items-center justify-center w-5 h-5 rounded-full text-ink-4 hover:bg-paper-2 hover:text-ink sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 data-popup-open:opacity-100 transition-opacity disabled:opacity-50"
            >
              <MoreHorizontal size={12} />
            </button>
          }
        />
        <DropdownMenuContent align="end" className="min-w-36">
          <DropdownMenuItem onClick={() => setRenameOpen(true)}>
            <Pencil />
            Rename
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameDialog row={row} open={renameOpen} onOpenChange={setRenameOpen} />
    </div>
  );
}

function RenameDialog({
  row,
  open,
  onOpenChange,
}: {
  row: SavedSearchRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();

  const onSubmit = (formData: FormData) => {
    const name = String(formData.get("name") ?? "");
    startTransition(async () => {
      const res = await renameSavedSearch(row.id, name);
      if (!res.ok) {
        alert(res.error);
        return;
      }
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename saved search</DialogTitle>
        </DialogHeader>
        <form action={onSubmit} className="flex flex-col gap-3">
          <input
            // Re-key on open so a cancelled edit doesn't linger.
            key={open ? "open" : "closed"}
            name="name"
            defaultValue={row.name}
            required
            maxLength={80}
            autoFocus
            aria-label="Saved search name"
            className="w-full h-9 px-3 rounded-md border border-line-2 bg-white text-sm text-ink focus:outline-none focus:border-brand-300 transition-colors"
          />
          <DialogFooter>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="h-8 px-3 rounded-md border border-line-2 text-xs text-ink-3 hover:bg-paper-2 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="h-8 px-3 rounded-md bg-brand-500 text-xs text-white hover:bg-brand-600 disabled:opacity-50 transition-colors"
            >
              Save
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
