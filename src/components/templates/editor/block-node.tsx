"use client";

/**
 * `block` atom: a reference to a reusable block. Renders the block's
 * content read-only with sample data (sanitized HTML from the same
 * pipeline as the preview). Click opens the block editor.
 */

import { useMemo } from "react";
import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { cn } from "@/lib/utils";
import { SAMPLE_TEMPLATE_DATA } from "@/lib/templates/catalog";
import { renderTemplate, type BlockSource } from "@/lib/templates/render";
import { DEFAULT_PARAGRAPH_STYLES } from "@/lib/templates/page-style";
import { resolvedToHtml } from "@/lib/templates/to-html";

export type BlockOptions = {
  blocks: BlockSource[];
  onEditBlock?: (id: string) => void;
};

/** Sanitized sample-data HTML for a block, or null when it is missing. */
export function blockPreview(
  blockId: string,
  blocks: BlockSource[],
): { name: string; html: string; archived: boolean } | null {
  const block = blocks.find((b) => b.id === blockId);
  if (!block) return null;
  const map = new Map(blocks.map((b) => [b.id, b]));
  try {
    const { doc } = renderTemplate(block.content, {
      data: SAMPLE_TEMPLATE_DATA,
      blocks: map,
      styles: DEFAULT_PARAGRAPH_STYLES,
    });
    return { name: block.name, html: resolvedToHtml(doc), archived: !block.isActive };
  } catch {
    return {
      name: block.name,
      html: "<p>[Block preview unavailable]</p>",
      archived: !block.isActive,
    };
  }
}

function BlockView(props: NodeViewProps) {
  const blockId = String(props.node.attrs.blockId);
  const opts = props.extension.options as BlockOptions;
  const preview = useMemo(() => blockPreview(blockId, opts.blocks), [blockId, opts.blocks]);
  return (
    <NodeViewWrapper
      data-block-ref=""
      contentEditable={false}
      className={cn(
        "my-2 rounded border border-line bg-paper-2/50 select-none",
        props.selected && "ring-2 ring-brand-500/40",
      )}
    >
      <div
        className="flex cursor-pointer items-center justify-between px-2 py-1 text-[11px] font-medium text-ink-3"
        onClick={() => opts.onEditBlock?.(blockId)}
      >
        <span>{preview ? `Block: ${preview.name}` : "Missing block"}</span>
        {preview?.archived && <span className="text-amber-700">Archived</span>}
      </div>
      {preview ? (
        <div
          className="prose prose-sm max-w-none px-2 pb-1 text-xs"
          // Sanitized by resolvedToHtml (sanitizeDocumentHtml).
          dangerouslySetInnerHTML={{ __html: preview.html }}
        />
      ) : (
        <div className="px-2 pb-1 text-xs text-red-700">[Missing block]</div>
      )}
    </NodeViewWrapper>
  );
}

export const BlockNode = Node.create<BlockOptions>({
  name: "block",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addOptions: () => ({ blocks: [] }),
  addAttributes() {
    return { blockId: { default: "" } };
  },
  parseHTML: () => [{ tag: "div[data-block-ref]" }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, { "data-block-ref": node.attrs.blockId }),
  ],
  addNodeView: () => ReactNodeViewRenderer(BlockView),
  addCommands() {
    return {
      insertBlock:
        (blockId) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { blockId } }),
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockRef: {
      insertBlock: (blockId: string) => ReturnType;
    };
  }
}
