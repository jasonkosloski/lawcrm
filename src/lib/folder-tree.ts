/**
 * Folder-tree helpers — pure functions over flat DocumentFolder rows.
 *
 * The query layer fetches a matter's folders in ONE query (flat
 * rows); everything shape-related happens here in JS: building the
 * nested tree for the left rail, flattening it back (with depth) for
 * indent-rendered pickers, breadcrumb paths, depth/height math for
 * the nesting cap, descendant collection for move-cycle checks, and
 * the " (2)"-style rename used when a deleted folder's children
 * re-parent into a name collision.
 *
 * Shared by the server action layer (src/app/actions/document-folders.ts),
 * the query layer, and client components (picker exclusion) — keep it
 * dependency-free and side-effect-free.
 */

/** Flat row shape — the minimal projection the helpers need. */
export type FolderRecord = {
  id: string;
  parentId: string | null;
  name: string;
  order: number;
};

/** Nested node for the tree rail. Serializable (plain arrays) so a
 *  server component can pass it straight into a client component. */
export type FolderNode = {
  id: string;
  parentId: string | null;
  name: string;
  children: FolderNode[];
};

/** Flattened tree entry — depth drives picker indentation. Depth is
 *  1-based: a root-level folder has depth 1. */
export type FlatFolder = {
  id: string;
  parentId: string | null;
  name: string;
  depth: number;
};

/** Maximum nesting depth (1-based). A folder at depth 8 cannot take
 *  children. Deep discovery productions rarely exceed 4–5 levels;
 *  the cap exists so a runaway import can't build an unusable rail. */
export const MAX_FOLDER_DEPTH = 8;

/** Documents moved per `moveDocuments` call — covers "select a
 *  production, re-file it" without letting one action pin the DB on
 *  thousands of rows. Lives here (not in the "use server" action
 *  module, which may only export async functions) so client UIs can
 *  read it too. */
export const MOVE_DOCUMENTS_BATCH_CAP = 200;

const byOrderThenName = (a: FolderRecord, b: FolderRecord): number =>
  a.order - b.order || a.name.localeCompare(b.name);

/** Build the nested tree from flat rows. Orphaned rows (parentId
 *  pointing at a missing id — shouldn't happen, but never crash the
 *  Documents tab over bad data) are treated as roots. Siblings sort
 *  by `order` then name at every level. */
export function buildFolderTree(rows: FolderRecord[]): FolderNode[] {
  const byId = new Map<string, FolderNode>(
    rows.map((r) => [
      r.id,
      { id: r.id, parentId: r.parentId, name: r.name, children: [] },
    ])
  );
  const roots: FolderNode[] = [];
  for (const r of [...rows].sort(byOrderThenName)) {
    const node = byId.get(r.id)!;
    const parent = r.parentId ? byId.get(r.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** Depth-first flatten with 1-based depth — picker + tree-rail
 *  ordering matches the visual nesting. */
export function flattenFolderTree(
  nodes: FolderNode[],
  depth = 1
): FlatFolder[] {
  const out: FlatFolder[] = [];
  for (const n of nodes) {
    out.push({ id: n.id, parentId: n.parentId, name: n.name, depth });
    out.push(...flattenFolderTree(n.children, depth + 1));
  }
  return out;
}

/** 1-based depth of a folder (root-level = 1). Returns 0 for an
 *  unknown id. Cycles in bad data terminate via the visited set. */
export function folderDepth(rows: FolderRecord[], id: string): number {
  const parentOf = new Map(rows.map((r) => [r.id, r.parentId]));
  if (!parentOf.has(id)) return 0;
  let depth = 0;
  let cur: string | null = id;
  const seen = new Set<string>();
  while (cur && parentOf.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    depth += 1;
    cur = parentOf.get(cur) ?? null;
  }
  return depth;
}

/** Height of the subtree rooted at `id` — 1 for a leaf. Used with
 *  folderDepth to enforce MAX_FOLDER_DEPTH on moves (destination
 *  depth + moving subtree height must stay within the cap). */
export function subtreeHeight(rows: FolderRecord[], id: string): number {
  const childrenOf = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.parentId) continue;
    const list = childrenOf.get(r.parentId) ?? [];
    list.push(r.id);
    childrenOf.set(r.parentId, list);
  }
  const height = (cur: string, seen: Set<string>): number => {
    if (seen.has(cur)) return 0; // bad-data cycle guard
    seen.add(cur);
    const kids = childrenOf.get(cur) ?? [];
    let max = 0;
    for (const k of kids) max = Math.max(max, height(k, seen));
    return 1 + max;
  };
  return rows.some((r) => r.id === id) ? height(id, new Set()) : 0;
}

/** Minimal parent-link shape — lets the graph helpers below run on
 *  FolderRecord and FlatFolder alike (client pickers only carry the
 *  flat shape). */
type FolderRef = { id: string; parentId: string | null };

/** Every id underneath `id` (NOT including `id` itself). Move-cycle
 *  check: a folder may not move under itself or a descendant. */
export function collectDescendantIds(
  rows: FolderRef[],
  id: string
): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.parentId) continue;
    const list = childrenOf.get(r.parentId) ?? [];
    list.push(r.id);
    childrenOf.set(r.parentId, list);
  }
  const out = new Set<string>();
  const queue = [...(childrenOf.get(id) ?? [])];
  while (queue.length > 0) {
    const cur = queue.pop()!;
    if (out.has(cur)) continue; // bad-data cycle guard
    out.add(cur);
    queue.push(...(childrenOf.get(cur) ?? []));
  }
  return out;
}

/** Root → folder breadcrumb path (inclusive). Empty for unknown ids. */
export function folderPath(
  rows: (FolderRef & { name: string })[],
  id: string
): { id: string; name: string }[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const path: { id: string; name: string }[] = [];
  let cur = byId.get(id);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift({ id: cur.id, name: cur.name });
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return path;
}

/** First available variant of `name` given the (lowercased) names
 *  already taken among the destination's siblings: "Exhibits",
 *  "Exhibits (2)", "Exhibits (3)", … Used when deleting a folder
 *  re-parents a child into a sibling-name collision. */
export function nextAvailableFolderName(
  name: string,
  takenLowercase: Set<string>
): string {
  if (!takenLowercase.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name} (${n})`;
    if (!takenLowercase.has(candidate.toLowerCase())) return candidate;
  }
}
