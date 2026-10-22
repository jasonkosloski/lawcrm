/**
 * Folder path above the document list. Every crumb (including "All
 * documents") is a drop target, so rows dragged out of a deep folder can
 * go straight to an ancestor.
 */

"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { folderPath, type FolderRecord } from "@/lib/folder-tree";
import { dropStateClass, useFolderDropTarget } from "./workspace-context";

export function FolderBreadcrumbs({
  basePath,
  folders,
  currentFolderId,
}: {
  basePath: string;
  folders: FolderRecord[];
  currentFolderId: string | null;
}) {
  const crumbs = currentFolderId ? folderPath(folders, currentFolderId) : [];
  return (
    <nav aria-label="Folder path" className="flex items-center gap-1 min-w-0 text-xs">
      <Crumb
        href={basePath}
        folderId={null}
        name="All documents"
        current={currentFolderId === null}
      />
      {crumbs.map((c, i) => (
        <span key={c.id} className="flex items-center gap-1 min-w-0">
          <ChevronRight size={12} className="shrink-0 text-ink-4" />
          <Crumb
            href={`${basePath}?folder=${c.id}`}
            folderId={c.id}
            name={c.name}
            current={i === crumbs.length - 1}
          />
        </span>
      ))}
    </nav>
  );
}

function Crumb({
  href,
  folderId,
  name,
  current,
}: {
  href: string;
  folderId: string | null;
  name: string;
  current: boolean;
}) {
  const { setNodeRef, dropProps, state } = useFolderDropTarget(folderId, "crumb");
  const ring = cn("rounded px-1 -mx-1 truncate", dropStateClass(state));
  return current ? (
    <span ref={setNodeRef} {...dropProps} className={cn("font-semibold text-ink", ring)}>
      {name}
    </span>
  ) : (
    <Link
      ref={setNodeRef}
      {...dropProps}
      href={href}
      draggable={false}
      className={cn("text-ink-3 hover:text-brand-700 hover:underline", ring)}
    >
      {name}
    </Link>
  );
}
