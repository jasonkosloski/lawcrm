/**
 * Server-side helpers shared by every action that renders a stored
 * template (documents, emails, texts): its content (legacy bodies
 * converted on the fly) and the blocks it references.
 */

import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { convertLegacyBody } from "./legacy";
import { collectBlockIds } from "./inspect";
import type { BlockSource } from "./render";
import type { TemplateDoc } from "./schema";

/** The blocks a doc references (plus `extraIds`, e.g. the firm style's
 *  letterhead/continuation), active AND archived (archived ones render a
 *  visible placeholder rather than vanishing). Unknown ids are absent
 *  from the map, which the renderer reports as deleted. */
export async function loadBlockMap(
  doc: TemplateDoc,
  extraIds: string[] = [],
): Promise<Map<string, BlockSource>> {
  const ids = [...new Set([...collectBlockIds(doc), ...extraIds])];
  const map = new Map<string, BlockSource>();
  if (ids.length === 0) return map;
  const rows = await prisma.templateBlock.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, isActive: true, content: true },
  });
  for (const r of rows) map.set(r.id, { ...r, content: r.content as unknown as TemplateDoc });
  return map;
}

/** Structured content, or the legacy `{{token}}` body converted on the fly. */
export const contentOf = (t: {
  content: Prisma.JsonValue | null;
  body: string | null;
}): TemplateDoc =>
  t.content ? (t.content as unknown as TemplateDoc) : convertLegacyBody(t.body ?? "");
