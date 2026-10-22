/**
 * The template body's TipTap editor. Rebuilt (schema and all) when the
 * kind or `rebuildKey` changes, starting from the current `content`
 * (JSON, or HTML when carrying content across a kind change).
 */

"use client";

import { useMemo } from "react";
import { useEditor } from "@tiptap/react";
import type { BlockSource } from "@/lib/templates/render";
import type { TemplateDoc, TemplateKind } from "@/lib/templates/schema";
import { cn } from "@/lib/utils";
import { createTemplateExtensions, templateJSON } from "./extensions";
import { FitHighlight } from "./fit-highlight";

export const BODY_CLASS = cn(
  "prose prose-sm max-w-none min-h-[420px] px-6 py-5 text-xs text-ink focus:outline-none",
  "[&_table]:border-collapse [&_td]:border [&_td]:border-line [&_td]:p-1 [&_th]:border [&_th]:border-line [&_th]:p-1",
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
  /** Must be stable: baked into the extensions. */
  onEditField: (pos: number) => void;
  onEditRule: (pos: number) => void;
}) {
  const { kind, isBlock, blocks, onEditField, onEditRule } = opts;
  const extensions = useMemo(
    () => [
      ...createTemplateExtensions({
        kind,
        isBlock,
        blocks,
        onEditField,
        onEditRule,
        onEditBlock: openBlock,
      }),
      FitHighlight,
    ],
    [kind, isBlock, blocks, onEditField, onEditRule],
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
