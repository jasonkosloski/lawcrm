/** ResolvedDoc -> plain text. Blocks are separated by blank lines. */

import type { ResolvedBlock, ResolvedDoc, ResolvedInline } from "./render";

const inline = (nodes: ResolvedInline[] | undefined) =>
  (nodes ?? []).map((n) => (n.type === "hardBreak" ? "\n" : n.text)).join("");

function blockText(b: ResolvedBlock, indent = ""): string {
  switch (b.type) {
    case "paragraph":
    case "heading":
      return inline(b.content);
    case "bulletList":
    case "orderedList":
      return b.content
        .map((li, i) => {
          const marker = b.type === "bulletList" ? "- " : `${i + 1}. `;
          const body = li.content.map((c) => blockText(c, indent + "  ")).join("\n");
          return `${indent}${marker}${body}`;
        })
        .join("\n");
    case "table":
      return b.content
        .map((r) =>
          r.content
            .map((c) =>
              c.content
                .map((x) => blockText(x))
                .join(" ")
                .replace(/\s*\n\s*/g, " "),
            )
            .join("\t"),
        )
        .join("\n");
    case "pageBreak":
      return "";
  }
}

export function resolvedToText(doc: ResolvedDoc): string {
  return (doc.content ?? [])
    .map((b) => blockText(b))
    .filter((t) => t !== "")
    .join("\n\n")
    .trim();
}
