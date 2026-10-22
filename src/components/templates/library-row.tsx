/**
 * One row of the template library (a template or a block): the name
 * links to its editor page; the overflow menu offers archive / restore
 * (edit key) and hard delete (delete key). Actions are passed in so the
 * same row serves both tabs; each re-checks permissions server-side.
 */

"use client";

import Link from "next/link";
import { useTransition, type ReactNode } from "react";
import { Archive, ArchiveRestore, MoreHorizontal, Trash2, type LucideIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { confirmAction, notifyError } from "@/lib/feedback";

type Result = { ok: boolean; error?: string };

export function LibraryRow({
  href,
  name,
  icon: Icon,
  description,
  meta,
  tags,
  isActive,
  canEdit,
  canDelete,
  deleteNoun,
  onSetActive,
  onDelete,
}: {
  href: string;
  name: string;
  icon: LucideIcon;
  description: string | null;
  meta: ReactNode;
  tags?: ReactNode;
  isActive: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** "template" | "block", for the confirm copy. */
  deleteNoun: string;
  onSetActive: (active: boolean) => Promise<Result>;
  onDelete: () => Promise<Result>;
}) {
  const [pending, startTransition] = useTransition();

  const toggleArchive = () => {
    startTransition(async () => {
      const res = await onSetActive(!isActive);
      if (!res.ok) notifyError(res.error ?? `Couldn't update ${deleteNoun}.`);
    });
  };

  const remove = async () => {
    if (
      !(await confirmAction({
        title: `Permanently delete "${name}"?`,
        description: `This can't be undone. Prefer Archive unless the ${deleteNoun} was a mistake.`,
        confirmLabel: `Delete ${deleteNoun}`,
        destructive: true,
      }))
    ) {
      return;
    }
    startTransition(async () => {
      const res = await onDelete();
      if (!res.ok) notifyError(res.error ?? `Couldn't delete ${deleteNoun}.`);
    });
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-md border border-line bg-white",
        !isActive && "opacity-70",
      )}
    >
      <Icon size={14} className="text-ink-4 shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Link
            href={href}
            className="text-xs font-medium text-ink truncate hover:text-brand-700 hover:underline"
          >
            {name}
          </Link>
          {tags}
          {!isActive && <span className="text-2xs text-ink-4 font-mono shrink-0">archived</span>}
        </div>
        {description && <div className="text-2xs text-ink-4 truncate">{description}</div>}
      </div>

      <div className="hidden sm:flex flex-col items-end text-2xs text-ink-4 font-mono shrink-0">
        {meta}
      </div>

      {(canEdit || canDelete) && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label={`Actions for ${name}`}
                disabled={pending}
                className="inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-4 hover:bg-paper-2 hover:text-ink disabled:opacity-50"
              >
                <MoreHorizontal size={14} />
              </button>
            }
          />
          <DropdownMenuContent align="end" className="min-w-44">
            {canEdit && (
              <DropdownMenuItem onClick={toggleArchive}>
                {isActive ? <Archive /> : <ArchiveRestore />}
                {isActive ? "Archive" : "Restore"}
              </DropdownMenuItem>
            )}
            {canDelete && (
              <>
                {canEdit && <DropdownMenuSeparator />}
                <DropdownMenuItem variant="destructive" onClick={remove}>
                  <Trash2 />
                  Delete permanently
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
