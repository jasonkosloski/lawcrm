/**
 * Converts an old plain-text `{{token}}` template body into structured
 * content. Only tokens naming a catalog field become field nodes; anything
 * else (typos, lists, malformed braces) stays literal text as written.
 */

import { fieldByPath } from "./catalog";
import type { HardBreakNode, InlineNode, ParagraphNode, TemplateDoc } from "./schema";

const TOKEN_RE = /\{\{([^{}]{0,80})\}\}/g;
const KEY_RE = /^[A-Za-z0-9_.]+$/;

function inlineLine(line: string, out: InlineNode[]) {
  let last = 0;
  const text = (s: string) => {
    if (s) out.push({ type: "text", text: s });
  };
  for (const m of line.matchAll(TOKEN_RE)) {
    const key = m[1].trim();
    if (!KEY_RE.test(key) || !fieldByPath(key)) continue;
    text(line.slice(last, m.index));
    out.push({ type: "field", attrs: { path: key, format: null } });
    last = m.index + m[0].length;
  }
  text(line.slice(last));
}

export function convertLegacyBody(body: string): TemplateDoc {
  const paragraphs = body.replace(/\r\n/g, "\n").split(/\n\s*\n/);
  const content: ParagraphNode[] = paragraphs.map((p) => {
    const inline: InlineNode[] = [];
    p.split("\n").forEach((line, i) => {
      if (i > 0) inline.push({ type: "hardBreak" } satisfies HardBreakNode);
      inlineLine(line, inline);
    });
    const node: ParagraphNode = { type: "paragraph", attrs: { textAlign: null } };
    if (inline.length) node.content = inline;
    return node;
  });
  return { type: "doc", content };
}
