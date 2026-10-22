/**
 * Converts an old plain-text `{{token}}` template body into structured
 * content. Every well-formed key becomes a field node (catalog or not), so
 * typos surface in the render report and the editor's fit check instead of
 * silently printing; malformed braces stay literal text as written.
 * Runs of blank lines keep their spacing as extra empty paragraphs.
 */

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
    if (!KEY_RE.test(key)) continue;
    // `{{a{{b}}`: an unclosed opener before this token makes it malformed.
    if (line.slice(last, m.index).includes("{{")) continue;
    text(line.slice(last, m.index));
    out.push({ type: "field", attrs: { path: key, format: null } });
    last = m.index + m[0].length;
  }
  text(line.slice(last));
}

export function convertLegacyBody(body: string): TemplateDoc {
  // Each separator is a blank-line run; N blank lines = N-1 extra empty paragraphs.
  const parts = body.replace(/\r\n/g, "\n").split(/(\n\s*\n)/);
  const paragraphs: string[] = [];
  parts.forEach((part, i) => {
    if (i % 2 === 0) paragraphs.push(part);
    else for (let k = 0; k < part.match(/\n/g)!.length - 2; k++) paragraphs.push("");
  });
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
