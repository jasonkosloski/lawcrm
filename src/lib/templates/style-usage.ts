/**
 * Where a paragraph style is referenced: templates and blocks. Deleting a
 * custom style is refused while anything points at it, so the paragraphs
 * never silently fall back to Body. Server-only (reads the database).
 */

import { prisma } from "@/lib/prisma";

/** Every `attrs.style` string found anywhere in a TipTap JSON document. */
export function styleKeysIn(doc: unknown): Set<string> {
  const keys = new Set<string>();
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const n = node as { attrs?: unknown; content?: unknown };
    if (n.attrs && typeof n.attrs === "object") {
      const style = (n.attrs as { style?: unknown }).style;
      if (typeof style === "string") keys.add(style);
    }
    walk(n.content);
  };
  walk(doc);
  return keys;
}

type Usage = { templates: string[]; blocks: string[] };

/** Style key -> names of the templates and blocks using it, from one scan. */
export async function styleUsageMap(): Promise<Map<string, Usage>> {
  const [templates, blocks] = await Promise.all([
    prisma.documentTemplate.findMany({
      select: { name: true, content: true },
      orderBy: { name: "asc" },
    }),
    prisma.templateBlock.findMany({
      select: { name: true, content: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const map = new Map<string, Usage>();
  const add = (kind: keyof Usage, rows: { name: string; content: unknown }[]) => {
    for (const r of rows) {
      for (const key of styleKeysIn(r.content)) {
        const u = map.get(key) ?? { templates: [], blocks: [] };
        u[kind].push(r.name);
        map.set(key, u);
      }
    }
  };
  add("templates", templates);
  add("blocks", blocks);
  return map;
}

/** Names of the templates and blocks whose content uses the style key. */
export async function styleUsage(key: string): Promise<Usage> {
  return (await styleUsageMap()).get(key) ?? { templates: [], blocks: [] };
}
