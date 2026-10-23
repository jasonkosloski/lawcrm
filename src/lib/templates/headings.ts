/**
 * Legacy headings: `heading` nodes stay valid input but are really
 * paragraphs in the heading1..3 styles. Pure; returns a new tree.
 */

import type { TemplateDoc } from "./schema";

type Loose = { type?: string; attrs?: Record<string, unknown>; content?: Loose[] };

function convert(node: Loose): Loose {
  if (node.type === "heading") {
    const { level, textAlign, ...rest } = node.attrs ?? {};
    const attrs: Record<string, unknown> = { ...rest, style: `heading${String(level)}` };
    if (textAlign !== undefined) attrs.textAlign = textAlign;
    const out: Loose = { ...node, type: "paragraph", attrs };
    if (node.content) out.content = node.content.map(convert);
    return out;
  }
  if (!node.content) return node;
  return { ...node, content: node.content.map(convert) };
}

export function convertHeadings(doc: TemplateDoc): TemplateDoc {
  return convert(doc as Loose) as TemplateDoc;
}
