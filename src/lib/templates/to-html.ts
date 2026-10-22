/** ResolvedDoc -> sanitized HTML (preview and in-app display). */

import { sanitizeDocumentHtml } from "@/lib/sanitize-html";
import type {
  ResolvedBlock,
  ResolvedDoc,
  ResolvedInline,
  ResolvedListItem,
  ResolvedTableCell,
} from "./render";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

// Outermost first: missing wraps everything, then bold > italic > underline.
const MARK_TAGS: [string, string][] = [
  ["bold", "strong"],
  ["italic", "em"],
  ["underline", "u"],
];

function inline(nodes: ResolvedInline[] | undefined): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === "hardBreak") return "<br />";
      const types = new Set((n.marks ?? []).map((m) => m.type));
      let out = esc(n.text);
      for (const [type, tag] of [...MARK_TAGS].reverse()) {
        if (types.has(type as never)) out = `<${tag}>${out}</${tag}>`;
      }
      return types.has("missing") ? `<mark data-missing>${out}</mark>` : out;
    })
    .join("");
}

const align = (a?: string | null) => (a ? ` style="text-align:${a}"` : "");

function listItem(li: ResolvedListItem): string {
  return `<li>${li.content.map(block).join("")}</li>`;
}

function cell(c: ResolvedTableCell): string {
  const tag = c.type === "tableHeader" ? "th" : "td";
  const inner = c.content.map((b) => (b.type === "paragraph" ? inline(b.content) : block(b)));
  return `<${tag}>${inner.join("<br />")}</${tag}>`;
}

function block(b: ResolvedBlock): string {
  switch (b.type) {
    case "paragraph":
      return `<p${align(b.attrs?.textAlign)}>${inline(b.content)}</p>`;
    case "heading":
      return `<h${b.attrs.level}${align(b.attrs.textAlign)}>${inline(b.content)}</h${b.attrs.level}>`;
    case "bulletList":
      return `<ul>${b.content.map(listItem).join("")}</ul>`;
    case "orderedList":
      return `<ol>${b.content.map(listItem).join("")}</ol>`;
    case "table":
      return `<table>${b.content
        .map((r) => `<tr>${r.content.map(cell).join("")}</tr>`)
        .join("")}</table>`;
    case "pageBreak":
      return "<hr data-page-break>";
  }
}

export function resolvedToHtml(doc: ResolvedDoc): string {
  return sanitizeDocumentHtml((doc.content ?? []).map(block).join(""));
}
