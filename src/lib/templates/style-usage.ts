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

/** Names of the templates and blocks whose content uses the style key. */
export async function styleUsage(key: string): Promise<{ templates: string[]; blocks: string[] }> {
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
  const uses = (r: { content: unknown }) => styleKeysIn(r.content).has(key);
  return {
    templates: templates.filter(uses).map((t) => t.name),
    blocks: blocks.filter(uses).map((b) => b.name),
  };
}
