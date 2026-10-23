/**
 * The database side of the block graph rules, shared by the block and
 * template save actions (a "use server" file can export only actions, so
 * the lock and the whole-graph load live here).
 */

import type { Tx } from "@/lib/prisma";
import { height, MAX_BLOCK_DEPTH, SCOPE_WORD, scopeCovers } from "./block-graph";
import type { BlockSource } from "./render";
import type { AppliesTo, TemplateDoc } from "./schema";

/** Advisory lock key for "template block graph". Saves that can change
 *  the graph take it, so two racing saves cannot each pass the loop and
 *  depth checks and together break them. */
export const BLOCK_GRAPH_LOCK = 73010001;

/** Take the block graph lock until `tx` ends. */
export async function lockBlockGraph(tx: Pick<Tx, "$executeRaw">): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BLOCK_GRAPH_LOCK}::bigint)`;
}

/** Every block (active and archived), keyed by id. */
export async function loadAllBlocks(
  tx: Pick<Tx, "templateBlock">,
): Promise<Map<string, BlockSource>> {
  const rows = await tx.templateBlock.findMany({
    select: { id: true, name: true, isActive: true, content: true, appliesTo: true },
  });
  return new Map(
    rows.map((r) => [
      r.id,
      { ...r, content: r.content as unknown as TemplateDoc, appliesTo: r.appliesTo as AppliesTo },
    ]),
  );
}

export const MISSING_BLOCK = "A referenced block no longer exists.";
export const TOO_DEEP = `This would nest blocks more than ${MAX_BLOCK_DEPTH} deep.`;

/** The first save-time refusal for a piece's direct children: a missing
 *  block, then a block whose scope doesn't cover the host's (rule 2). */
export function childrenError(
  children: string[],
  blocks: ReadonlyMap<string, BlockSource>,
  host: AppliesTo,
  noun: "template" | "block",
): string | null {
  if (children.some((id) => !blocks.has(id))) return MISSING_BLOCK;
  for (const id of children) {
    const b = blocks.get(id)!;
    const scope = b.appliesTo ?? "both";
    if (!scopeCovers(scope, host)) {
      return `${b.name} applies to ${SCOPE_WORD[scope]} only, so it can't go in a ${SCOPE_WORD[host]} ${noun}.`;
    }
  }
  return null;
}

/** Whether a template whose own blocks are `children` would nest too deep. */
export const templateTooDeep = (
  children: string[],
  blocks: ReadonlyMap<string, BlockSource>,
): boolean => children.some((id) => height(id, blocks) > MAX_BLOCK_DEPTH);
