/**
 * Pure logic for the document viewer's left-hand file tree
 * (src/components/documents-viewer/document-file-tree.tsx): files
 * grouped by folder, the name filter, and which folders start
 * expanded. Folder nesting itself comes from `buildFolderTree`
 * (src/lib/folder-tree.ts), the same tree the Documents tab uses.
 */

import type { FolderNode } from "@/lib/folder-tree";

export type TreeFile = { id: string; name: string; folderId: string | null };

/** Key for the matter root (files with no folder). */
export const ROOT_KEY = "__root__";

/** Files per folder (ROOT_KEY for the root), keeping input order. */
export function filesByFolder<F extends TreeFile>(files: F[]): Map<string, F[]> {
  const out = new Map<string, F[]>();
  for (const f of files) {
    const key = f.folderId ?? ROOT_KEY;
    const list = out.get(key);
    if (list) list.push(f);
    else out.set(key, [f]);
  }
  return out;
}

/** Ids of `folderId` and every folder above it — what starts expanded so
 *  the current document is visible. Empty for the root. */
export function ancestorChain(tree: FolderNode[], folderId: string | null): string[] {
  if (!folderId) return [];
  const path: string[] = [];
  const walk = (nodes: FolderNode[]): boolean => {
    for (const n of nodes) {
      path.push(n.id);
      if (n.id === folderId || walk(n.children)) return true;
      path.pop();
    }
    return false;
  };
  return walk(tree) ? path : [];
}

/** Case- and accent-insensitive "contains", ignoring surrounding space. */
export function nameMatches(name: string, query: string): boolean {
  const norm = (s: string) =>
    s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const q = norm(query.trim());
  return q === "" || norm(name).includes(q);
}

/**
 * The filtered view: which files match `query`, and which folders to
 * show (a folder whose name matches shows with all its files; otherwise
 * a folder shows only when something under it matches). An empty query
 * shows everything (`null`).
 */
export function filterTree<F extends TreeFile>(
  tree: FolderNode[],
  byFolder: Map<string, F[]>,
  query: string
): { files: Set<string>; folders: Set<string> } | null {
  if (query.trim() === "") return null;
  const files = new Set<string>();
  const folders = new Set<string>();
  for (const f of byFolder.get(ROOT_KEY) ?? []) if (nameMatches(f.name, query)) files.add(f.id);
  const visit = (node: FolderNode, ancestorMatched: boolean): boolean => {
    const selfMatched = ancestorMatched || nameMatches(node.name, query);
    let any = selfMatched;
    for (const f of byFolder.get(node.id) ?? []) {
      if (selfMatched || nameMatches(f.name, query)) {
        files.add(f.id);
        any = true;
      }
    }
    for (const child of node.children) if (visit(child, selfMatched)) any = true;
    if (any) folders.add(node.id);
    return any;
  };
  for (const n of tree) visit(n, false);
  return { files, folders };
}
