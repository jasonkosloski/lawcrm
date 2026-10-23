/**
 * Server-side helpers shared by every action that renders a stored
 * template (documents, emails, texts): its content (legacy bodies
 * converted on the fly) and the blocks it references.
 */

import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { convertLegacyBody } from "./legacy";
import { childIds, MAX_BLOCK_DEPTH } from "./block-graph";
import type { BlockSource } from "./render";
import type { AppliesTo, TemplateDoc } from "./schema";

/** The blocks a doc references (plus `extraIds`, e.g. the firm style's
 *  letterhead/continuation, and `replacementIds`, a court's replacement
 *  blocks), and the blocks those contain, level by level up to
 *  MAX_BLOCK_DEPTH (one query per level). Active AND archived (archived
 *  ones render a visible placeholder rather than vanishing). Unknown ids
 *  are absent from the map, which the renderer reports as deleted. */
export async function loadBlockMap(
  doc: TemplateDoc,
  extraIds: string[] = [],
  replacementIds: string[] = [],
): Promise<Map<string, BlockSource>> {
  const map = new Map<string, BlockSource>();
  let level = [...new Set([...childIds(doc), ...extraIds, ...replacementIds])];
  for (let depth = 0; depth < MAX_BLOCK_DEPTH && level.length > 0; depth++) {
    const rows = await prisma.templateBlock.findMany({
      where: { id: { in: level } },
      select: { id: true, name: true, isActive: true, content: true, appliesTo: true },
    });
    const next = new Set<string>();
    for (const r of rows) {
      const content = r.content as unknown as TemplateDoc;
      map.set(r.id, { ...r, content, appliesTo: r.appliesTo as AppliesTo });
      for (const id of childIds(content)) if (!map.has(id)) next.add(id);
    }
    // A child seen earlier in this same level is already loaded.
    level = [...next].filter((id) => !map.has(id));
  }
  return map;
}

/** Structured content, or the legacy `{{token}}` body converted on the fly. */
export const contentOf = (t: {
  content: Prisma.JsonValue | null;
  body: string | null;
}): TemplateDoc =>
  t.content ? (t.content as unknown as TemplateDoc) : convertLegacyBody(t.body ?? "");
