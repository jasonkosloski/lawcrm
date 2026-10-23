/** Reads the paragraphs a selection touches (a text range, several paragraphs or table cells). */

import type { Editor } from "@tiptap/react";

/** The direct settings a paragraph can carry (content attribute names). */
export const DIRECT_KEYS = [
  "textAlign",
  "spaceBeforePt",
  "spaceAfterPt",
  "lineSpacing",
  "indentLeftIn",
  "indentRightIn",
  "firstLine",
  "keepWithNext",
  "keepLinesTogether",
  "pageBreakBefore",
] as const;
export type DirectKey = (typeof DIRECT_KEYS)[number];

/** Attributes of every paragraph in the selection, in document order. */
export function selectedParagraphAttrs(editor: Editor): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const seen = new Set<number>();
  const { doc, selection } = editor.state;
  for (const r of selection.ranges) {
    doc.nodesBetween(r.$from.pos, r.$to.pos, (node, pos) => {
      if (node.type.name === "paragraph" && !seen.has(pos)) {
        seen.add(pos);
        out.push(node.attrs);
      }
    });
  }
  return out;
}

/** True when any selected paragraph carries a direct setting. */
export function hasDirectSettings(attrs: Record<string, unknown>[]): boolean {
  return attrs.some((a) => DIRECT_KEYS.some((k) => a[k] !== null && a[k] !== undefined));
}
