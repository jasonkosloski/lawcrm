/**
 * The template body's TipTap editor. Rebuilt (schema and all) when the
 * kind or `rebuildKey` changes, starting from the current `content`
 * (JSON, or HTML when carrying content across a kind change).
 */

"use client";

import { useMemo } from "react";
import { useEditor } from "@tiptap/react";
import type { BlockSource } from "@/lib/templates/render";
import { DEFAULT_PARAGRAPH_STYLES } from "@/lib/templates/page-style";
import type { ParagraphStyle } from "@/lib/templates/paragraph-styles";
import type { TemplateDoc, TemplateKind } from "@/lib/templates/schema";
import { cn } from "@/lib/utils";
import { EDITOR_CONTENT_CLASS } from "@/components/editor/editor-shell";
import { documentExtensions } from "@/components/editor/presets";
import { templateJSON } from "./extensions";
import { FitHighlight } from "./fit-highlight";

export const BODY_CLASS = cn(
  "prose prose-sm max-w-none min-h-[420px] px-6 py-5 text-xs text-ink focus:outline-none",
  EDITOR_CONTENT_CLASS,
  // Full-width tables fill the line (columns keep their proportions);
  // fit tables size to content. !important beats the resize view's inline width.
  "[&_table[data-width=full]]:!w-full [&_table[data-width=full]]:table-fixed [&_table[data-width=fit]]:!w-auto [&_table]:my-0",
  "[&_td]:relative [&_th]:relative [&_td>*]:my-0 [&_th>*]:my-0 [&_th]:text-left [&_th]:font-normal",
  "[&_.tableWrapper]:overflow-x-auto [&.resize-cursor]:cursor-col-resize",
  "[&_.column-resize-handle]:pointer-events-none [&_.column-resize-handle]:absolute [&_.column-resize-handle]:-right-0.5 [&_.column-resize-handle]:inset-y-0 [&_.column-resize-handle]:w-1 [&_.column-resize-handle]:bg-accent",
  "[&_.selectedCell]:bg-accent/10",
  // Cell paragraphs have no space after unless they carry their own value
  // (matches Word, PDF and the preview); beats the inline style. List items
  // keep their paragraph style's spacing, as in every output.
  "[&_td>p:not([data-space-after])]:!mb-0 [&_th>p:not([data-space-after])]:!mb-0",
  // A paragraph's style look arrives as custom properties (see extensions.ts).
  "[&_p]:[font-weight:var(--p-weight,normal)] [&_p]:[font-style:var(--p-style,normal)] [&_p]:[text-transform:var(--p-case,none)] [&_p]:[font-variant:var(--p-variant,normal)] [&_p]:[text-decoration:var(--p-deco,none)]",
);

const EDITOR_PROPS = { attributes: { "aria-label": "Template body", class: BODY_CLASS } };

const openBlock = (id: string) =>
  window.open(`/settings/templates/blocks/${id}`, "_blank", "noopener");

export function useBodyEditor(opts: {
  kind: TemplateKind;
  isBlock: boolean;
  blocks: BlockSource[];
  editable: boolean;
  content: TemplateDoc | string;
  rebuildKey: number;
  onDoc: (doc: TemplateDoc) => void;
  /** A user edit (not the initial load). */
  onEdit: () => void;
  onFocus: () => void;
  /** The firm's paragraph styles; must be stable. Defaults to the built-ins. */
  styles?: ParagraphStyle[];
  /** Must be stable: baked into the extensions. */
  onEditField: (pos: number) => void;
  onEditRule: (pos: number) => void;
}) {
  const { kind, isBlock, blocks, onEditField, onEditRule } = opts;
  const styles = opts.styles ?? DEFAULT_PARAGRAPH_STYLES;
  const extensions = useMemo(
    () => [
      ...documentExtensions({
        styles,
        kind,
        isBlock,
        blocks,
        onEditField,
        onEditRule,
        onEditBlock: openBlock,
      }),
      FitHighlight,
    ],
    [kind, isBlock, blocks, styles, onEditField, onEditRule],
  );
  return useEditor(
    {
      extensions,
      content: opts.content as never,
      editable: opts.editable,
      immediatelyRender: false,
      editorProps: EDITOR_PROPS,
      onCreate: ({ editor }) => opts.onDoc(templateJSON(editor)),
      onUpdate: ({ editor }) => {
        opts.onDoc(templateJSON(editor));
        opts.onEdit();
      },
      onFocus: opts.onFocus,
    },
    [kind, opts.rebuildKey],
  );
}
