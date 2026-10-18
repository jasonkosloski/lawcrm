/**
 * Left-hand file tree for the document viewer — the matter's folders
 * and files, so the reader can jump to any other document without going
 * back to the Documents tab.
 *
 *   - Folders come from the same tree as the Documents tab
 *     (`buildFolderTree`); files are listed folders-first under each.
 *   - The current document's folder chain starts expanded and the
 *     current file is highlighted and scrolled into view.
 *   - The filter box narrows by file or folder name (accent- and
 *     case-insensitive; a matching folder shows everything in it).
 *   - Big folders render the first FOLDER_RENDER_CAP files with a
 *     "Show all" button. When the matter is over the tree's load cap
 *     (`complete` false), only the current folder lists its files and
 *     the others link to the Documents tab.
 *   - The rail can be collapsed to a thin strip; that choice is a
 *     per-viewer convenience kept in localStorage.
 */

"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  AudioLines,
  ChevronDown,
  ChevronRight,
  File,
  FileText,
  Film,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Mail,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Sheet,
  Table,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FolderNode } from "@/lib/folder-tree";
import { ROOT_KEY, ancestorChain, filesByFolder, filterTree } from "@/lib/file-tree";
import type { FileTreeDocument } from "@/lib/queries/document-viewer";
import { resolveDocumentRenderer, type DocumentRenderer } from "./resolve-renderer";

const FOLDER_RENDER_CAP = 200;
const COLLAPSED_KEY = "lawcrm.viewer.fileTreeCollapsed";
const COLLAPSED_EVENT = "lawcrm:file-tree-collapsed";

/** The rail's collapsed preference, read from localStorage without a
 *  hydration mismatch (the server snapshot is "expanded"). Storage that
 *  throws (private mode, blocked site data) reads as expanded. */
function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}
function subscribeCollapsed(onChange: () => void): () => void {
  window.addEventListener(COLLAPSED_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(COLLAPSED_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
function writeCollapsed(value: boolean) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
  } catch {
    // Not persisted; the event below still updates this tab.
  }
  window.dispatchEvent(new Event(COLLAPSED_EVENT));
}

const ICON: Record<DocumentRenderer, LucideIcon> = {
  pdf: FileText,
  docx: FileText,
  doc_legacy: FileText,
  text: FileText,
  csv: Table,
  spreadsheet: Sheet,
  image: ImageIcon,
  tiff: ImageIcon,
  heic: ImageIcon,
  video: Film,
  audio: AudioLines,
  eml: Mail,
  msg: Mail,
  unsupported: File,
};

export function DocumentFileTree({
  matterId,
  tree,
  documents,
  complete,
  currentId,
  currentFolderId,
}: {
  matterId: string;
  tree: FolderNode[];
  documents: FileTreeDocument[];
  /** False when the matter is over the load cap: only the current
   *  folder's files are in `documents`. */
  complete: boolean;
  currentId: string;
  currentFolderId: string | null;
}) {
  const byFolder = useMemo(() => filesByFolder(documents), [documents]);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterTree(tree, byFolder, query), [tree, byFolder, query]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(ancestorChain(tree, currentFolderId)));
  const [showAll, setShowAll] = useState<Set<string>>(new Set());
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);

  // Navigating to a document in another folder opens that folder's chain.
  const [seenFolder, setSeenFolder] = useState(currentFolderId);
  if (seenFolder !== currentFolderId) {
    setSeenFolder(currentFolderId);
    setExpanded((s) => new Set([...s, ...ancestorChain(tree, currentFolderId)]));
  }

  const toggleCollapsed = () => writeCollapsed(!collapsed);

  const currentRef = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest" });
  }, [currentId, collapsed]);

  const toggle = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (collapsed) {
    return (
      <aside className="hidden shrink-0 lg:flex">
        <button
          type="button"
          onClick={toggleCollapsed}
          title="Show files"
          aria-label="Show files"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line bg-white text-ink-3 hover:border-brand-300 hover:text-brand-700"
        >
          <PanelLeftOpen className="h-3.5 w-3.5" aria-hidden />
        </button>
      </aside>
    );
  }

  const fileRow = (doc: FileTreeDocument, depth: number) => {
    const Icon = ICON[resolveDocumentRenderer(doc.contentType, doc.name)];
    const isCurrent = doc.id === currentId;
    return (
      <li key={doc.id}>
        <Link
          ref={isCurrent ? currentRef : undefined}
          href={`/matters/${matterId}/documents/${doc.id}`}
          aria-current={isCurrent ? "page" : undefined}
          title={doc.name}
          style={{ paddingLeft: 8 + depth * 12 }}
          className={cn(
            "flex items-center gap-1.5 rounded-md py-1 pr-2 text-xs",
            isCurrent ? "bg-brand-soft font-medium text-brand-700" : "text-ink-2 hover:bg-paper-2 hover:text-ink"
          )}
        >
          <Icon className="h-3.5 w-3.5 shrink-0 text-ink-4" aria-hidden />
          <span className="truncate">{doc.name}</span>
        </Link>
      </li>
    );
  };

  const filesIn = (key: string, depth: number) => {
    let files = byFolder.get(key) ?? [];
    if (filtered) files = files.filter((f) => filtered.files.has(f.id));
    if (files.length === 0) return null;
    const capped = !filtered && !showAll.has(key) && files.length > FOLDER_RENDER_CAP;
    const shown = capped ? files.slice(0, FOLDER_RENDER_CAP) : files;
    return (
      <>
        {shown.map((f) => fileRow(f, depth))}
        {capped && (
          <li>
            <button
              type="button"
              onClick={() => setShowAll((s) => new Set([...s, key]))}
              style={{ paddingLeft: 8 + depth * 12 }}
              className="py-1 text-2xs text-brand-700 hover:underline"
            >
              Show all {files.length.toLocaleString()} files
            </button>
          </li>
        )}
      </>
    );
  };

  const folderRow = (node: FolderNode, depth: number): React.ReactNode => {
    if (filtered && !filtered.folders.has(node.id)) return null;
    const open = filtered ? true : expanded.has(node.id);
    const listsFiles = complete || node.id === currentFolderId;
    const count = listsFiles ? (byFolder.get(node.id)?.length ?? 0) : null;
    return (
      <li key={node.id}>
        <button
          type="button"
          onClick={() => toggle(node.id)}
          aria-expanded={open}
          title={node.name}
          style={{ paddingLeft: 4 + depth * 12 }}
          className="flex w-full items-center gap-1 rounded-md py-1 pr-2 text-left text-xs text-ink-2 hover:bg-paper-2 hover:text-ink"
        >
          {open ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-ink-4" aria-hidden />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-ink-4" aria-hidden />
          )}
          {open ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-ink-4" aria-hidden />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-ink-4" aria-hidden />
          )}
          <span className="truncate">{node.name}</span>
          {count !== null && count > 0 && (
            <span className="ml-auto pl-1 font-mono text-2xs text-ink-4">{count}</span>
          )}
        </button>
        {open && (
          <ul>
            {node.children.map((c) => folderRow(c, depth + 1))}
            {listsFiles ? (
              filesIn(node.id, depth + 1)
            ) : (
              <li>
                <Link
                  href={`/matters/${matterId}/documents?folder=${node.id}`}
                  style={{ paddingLeft: 8 + (depth + 1) * 12 }}
                  className="block py-1 text-2xs text-brand-700 hover:underline"
                >
                  Open folder in Documents →
                </Link>
              </li>
            )}
          </ul>
        )}
      </li>
    );
  };

  const rootListsFiles = complete || currentFolderId === null;
  const nothing =
    filtered !== null && filtered.files.size === 0 && filtered.folders.size === 0;

  return (
    <aside aria-label="Matter files" className="hidden w-64 shrink-0 flex-col gap-2 lg:flex">
      <div className="flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-4" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter files"
            aria-label="Filter files"
            className="h-7 w-full rounded-md border border-line bg-white pl-7 pr-2 text-xs text-ink placeholder:text-ink-4 focus:border-brand-300 focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={toggleCollapsed}
          title="Hide files"
          aria-label="Hide files"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-white text-ink-3 hover:border-brand-300 hover:text-brand-700"
        >
          <PanelLeftClose className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <nav className="scrollbar-thin min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-white p-1.5">
        <ul>
          {tree.map((n) => folderRow(n, 0))}
          {rootListsFiles && filesIn(ROOT_KEY, 0)}
        </ul>
        {nothing && <div className="px-2 py-3 text-2xs text-ink-4">No files match “{query.trim()}”.</div>}
        {!complete && (
          <div className="mt-1 border-t border-line px-2 pt-2 text-2xs text-ink-4">
            This matter has too many files to list here; open other folders in Documents.
          </div>
        )}
      </nav>
    </aside>
  );
}
