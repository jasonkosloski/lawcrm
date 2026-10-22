/**
 * Folder tree rail — left-hand navigation for the matter document
 * browser.
 *
 * "All documents" (the matter root) sits on top; folders nest under
 * it with collapsible chevrons. Selection is URL-driven — every row
 * is a <Link> to `?folder=<id>` (or the bare tab path for the root),
 * so the browser back button and shared links Just Work; the server
 * page re-renders the file list for the selected folder.
 *
 * Expansion state is client-local (a Set of expanded ids). When the
 * selection changes — including via back/forward — the new
 * selection's ancestors auto-expand so the highlighted row is never
 * hidden inside a collapsed branch.
 *
 * Inside the documents workspace every row is also a drop target for
 * dragged rows and desktop files; hovering a drag over a collapsed
 * folder springs it open.
 */

"use client";

import { scopeBasePath, type RecordScope } from "@/lib/record-scope";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, ClipboardList, Files, Folder } from "lucide-react";
import { cn } from "@/lib/utils";
import { folderPath, type FolderNode } from "@/lib/folder-tree";
import { dropStateClass, useFolderDropTarget } from "@/components/documents/workspace-context";

/** How long a drag hovers over a collapsed folder before it opens. */
const SPRING_OPEN_MS = 600;

function collectAncestors(
  nodes: FolderNode[],
  selectedId: string | null
): string[] {
  if (!selectedId) return [];
  // folderPath works on flat parent-links; flatten just id/parent/name.
  const flat: { id: string; parentId: string | null; name: string }[] = [];
  const walk = (list: FolderNode[]) => {
    for (const n of list) {
      flat.push({ id: n.id, parentId: n.parentId, name: n.name });
      walk(n.children);
    }
  };
  walk(nodes);
  // Every path entry except the selected folder itself is an ancestor.
  return folderPath(flat, selectedId)
    .map((p) => p.id)
    .filter((id) => id !== selectedId);
}

export function FolderTree({
  scope,
  tree,
  counts,
  rootCount,
  selectedId,
}: {
  scope: RecordScope;
  tree: FolderNode[];
  /** Direct (non-recursive) document count per folder id. */
  counts: Record<string, number>;
  /** Documents sitting at the matter root (no folder). */
  rootCount: number;
  /** Currently selected folder — null = "All documents" root. */
  selectedId: string | null;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(collectAncestors(tree, selectedId))
  );

  // Auto-expand the new selection's ancestors when navigation moves
  // it (render-phase adjust, not an effect).
  const [prevSelected, setPrevSelected] = useState(selectedId);
  if (selectedId !== prevSelected) {
    setPrevSelected(selectedId);
    const ancestors = collectAncestors(tree, selectedId);
    if (ancestors.some((id) => !expanded.has(id))) {
      setExpanded(new Set([...expanded, ...ancestors]));
    }
  }

  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  const basePath = `${scopeBasePath(scope)}/documents`;
  const {
    setNodeRef: setRootRef,
    dropProps: rootDropProps,
    state: rootDropState,
  } = useFolderDropTarget(null, "tree");
  // Stable, so a hovering drag's spring-open timer isn't reset by re-renders.
  const open = useCallback(
    (id: string) => setExpanded((prev) => (prev.has(id) ? prev : new Set([...prev, id]))),
    []
  );

  const renderNode = (node: FolderNode, depth: number) => (
    <TreeNode
      key={node.id}
      node={node}
      depth={depth}
      basePath={basePath}
      selectedId={selectedId}
      counts={counts}
      expanded={expanded}
      toggle={toggle}
      open={open}
      renderChild={renderNode}
    />
  );

  return (
    <nav aria-label="Document folders" className="flex flex-col gap-0.5">
      <Link
        ref={setRootRef}
        {...rootDropProps}
        href={basePath}
        draggable={false}
        aria-current={selectedId === null ? "page" : undefined}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs",
          selectedId === null
            ? "bg-brand-soft text-brand-700 font-medium"
            : "text-ink-2 hover:bg-paper-2",
          dropStateClass(rootDropState)
        )}
      >
        <Files
          size={13}
          className={cn(
            "shrink-0",
            selectedId === null ? "text-brand-600" : "text-ink-4"
          )}
        />
        <span className="truncate">All documents</span>
        {rootCount > 0 && (
          <span className="ml-auto shrink-0 text-2xs font-mono text-ink-4">
            {rootCount}
          </span>
        )}
      </Link>
      {tree.map((node) => renderNode(node, 0))}
    </nav>
  );
}

function TreeNode({
  node,
  depth,
  basePath,
  selectedId,
  counts,
  expanded,
  toggle,
  open,
  renderChild,
}: {
  node: FolderNode;
  depth: number;
  basePath: string;
  selectedId: string | null;
  counts: Record<string, number>;
  expanded: Set<string>;
  toggle: (id: string) => void;
  open: (id: string) => void;
  renderChild: (node: FolderNode, depth: number) => ReactNode;
}) {
  const isSelected = node.id === selectedId;
  const isExpanded = expanded.has(node.id);
  const count = counts[node.id] ?? 0;
  const { setNodeRef, dropProps, state, isOver } = useFolderDropTarget(node.id, "tree");
  const canSpring = isOver && !isExpanded && node.children.length > 0;

  useEffect(() => {
    if (!canSpring) return;
    const t = setTimeout(() => open(node.id), SPRING_OPEN_MS);
    return () => clearTimeout(t);
  }, [canSpring, node.id, open]);

  return (
    <div>
      <div
        ref={setNodeRef}
        {...dropProps}
        className={cn(
          "group flex items-center gap-1 rounded-md pr-2",
          isSelected
            ? "bg-brand-soft text-brand-700"
            : "text-ink-2 hover:bg-paper-2",
          dropStateClass(state)
        )}
        style={{ paddingLeft: `${depth * 14}px` }}
      >
        {node.children.length > 0 ? (
          <button
            type="button"
            onClick={() => toggle(node.id)}
            aria-label={`${isExpanded ? "Collapse" : "Expand"} ${node.name}`}
            aria-expanded={isExpanded}
            className="shrink-0 w-5 h-6 inline-flex items-center justify-center text-ink-4 hover:text-ink-2"
          >
            {isExpanded ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )}
          </button>
        ) : (
          <span className="shrink-0 w-5" />
        )}
        <Link
          href={`${basePath}?folder=${node.id}`}
          draggable={false}
          className="flex items-center gap-1.5 flex-1 min-w-0 py-1 text-xs"
          aria-current={isSelected ? "page" : undefined}
        >
          <Folder
            size={13}
            className={cn(
              "shrink-0",
              isSelected ? "text-brand-600" : "text-ink-4"
            )}
          />
          <span
            className={cn("truncate", isSelected && "font-medium")}
            title={node.name}
          >
            {node.name}
          </span>
          {node.systemKind && (
            <ClipboardList
              size={11}
              className="shrink-0 text-ink-4"
              role="img"
              aria-label="Generated by a records request"
            />
          )}
          {count > 0 && (
            <span className="ml-auto shrink-0 text-2xs font-mono text-ink-4">
              {count}
            </span>
          )}
        </Link>
      </div>
      {isExpanded &&
        node.children.map((child) => renderChild(child, depth + 1))}
    </div>
  );
}
