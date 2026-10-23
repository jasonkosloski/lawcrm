/**
 * The block graph: blocks contain blocks by reference (`block` nodes),
 * templates are the roots. Pure helpers shared by the save actions (loop,
 * depth and scope rules) and the loader/renderer (depth limit). Every walk
 * is loop-safe, since stored content can already hold a loop (e.g. one a
 * court swap makes).
 */

import { collectBlockIds } from "./inspect";
import type { BlockSource } from "./render";
import type { AppliesTo, TemplateDoc } from "./schema";

/** A template's own blocks are level 1; level 5 is the deepest. */
export const MAX_BLOCK_DEPTH = 5;

/** How a scope reads in refusal messages. */
export const SCOPE_WORD: Record<AppliesTo, string> = {
  matter: "matter",
  lead: "lead",
  both: "matter-and-lead",
};

type Blocks = ReadonlyMap<string, BlockSource>;

/** The block ids a doc references directly. */
export const childIds = (doc: TemplateDoc): string[] => collectBlockIds(doc);

const childrenOf = (id: string, blocks: Blocks): string[] => {
  const b = blocks.get(id);
  return b ? childIds(b.content) : [];
};

/** Levels `id` spans: 1 with no children. A child missing from the map
 *  counts as 1; a block already on the walk counts 0 beyond itself. */
export function height(id: string, blocks: Blocks): number {
  const walk = (at: string, path: Set<string>): number => {
    if (path.has(at)) return 0;
    path.add(at);
    let below = 0;
    for (const c of childrenOf(at, blocks)) below = Math.max(below, walk(c, path));
    path.delete(at);
    return 1 + below;
  };
  return walk(id, new Set());
}

/** Block id → the blocks in the map that reference it directly. */
function parentIndex(blocks: Blocks): Map<string, string[]> {
  const parents = new Map<string, string[]>();
  for (const [id, b] of blocks) {
    for (const c of childIds(b.content)) {
      const list = parents.get(c);
      if (list) list.push(id);
      else parents.set(c, [id]);
    }
  }
  return parents;
}

/** Every block that transitively contains `id`. */
export function ancestors(id: string, blocks: Blocks): Set<string> {
  const parents = parentIndex(blocks);
  const out = new Set<string>();
  const queue = [id];
  while (queue.length) {
    for (const p of parents.get(queue.pop()!) ?? []) {
      if (p === id || out.has(p)) continue;
      out.add(p);
      queue.push(p);
    }
  }
  return out;
}

/** The longest chain of block ancestors above `id` (0 when only templates
 *  or nothing use it). */
export function depthAbove(id: string, blocks: Blocks): number {
  const parents = parentIndex(blocks);
  const walk = (at: string, path: Set<string>): number => {
    path.add(at);
    let up = 0;
    for (const p of parents.get(at) ?? []) {
      if (!path.has(p)) up = Math.max(up, 1 + walk(p, path));
    }
    path.delete(at);
    return up;
  };
  return walk(id, new Set());
}

/** Saving `doc` as block `selfId` would make a loop when one of its
 *  children already contains `selfId`: the ids from that child down to
 *  the block whose children include `selfId`. `[]` when `doc` references
 *  `selfId` directly; null when there is no loop. `selfId`'s stored
 *  content is never walked: `doc` replaces it. */
export function loopPath(selfId: string, doc: TemplateDoc, blocks: Blocks): string[] | null {
  const seen = new Set<string>();
  const walk = (at: string, path: string[]): string[] | null => {
    if (seen.has(at)) return null;
    seen.add(at);
    const here = [...path, at];
    const kids = childrenOf(at, blocks);
    if (kids.includes(selfId)) return here;
    for (const c of kids) {
      const found = walk(c, here);
      if (found) return found;
    }
    return null;
  };
  const top = childIds(doc);
  if (top.includes(selfId)) return [];
  for (const c of top) {
    const found = walk(c, []);
    if (found) return found;
  }
  return null;
}

/** Whether a block of scope `child` may sit in a `host`-scoped template or block. */
export const scopeCovers = (child: AppliesTo, host: AppliesTo): boolean =>
  child === "both" || child === host;
