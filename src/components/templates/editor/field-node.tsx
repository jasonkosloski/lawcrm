"use client";

/**
 * `field` and `listField` inline atoms: merge-field chips. Click opens
 * the host's property editor (`onEditField`). Marks (bold etc.) apply
 * to the chip like text.
 */

import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { cn } from "@/lib/utils";
import { listByPath } from "@/lib/templates/catalog";
import type { JoinStyle } from "@/lib/templates/schema";
import { FORMAT_LABELS, JOIN_LABELS, pathLabel, resolveField } from "./labels";

export function fieldChipText(
  path: string,
  format: string | null,
  repeatList?: string | null,
): string {
  const label = pathLabel(path, repeatList);
  const fmt = format ? (FORMAT_LABELS[format] ?? format) : null;
  return fmt ? `${label} · ${fmt}` : label;
}

export function listFieldChipText(a: {
  list: string;
  itemPath: string;
  join: JoinStyle | string;
}): string {
  const list = listByPath(a.list);
  const item = list?.itemFields.find((f) => f.path === a.itemPath);
  const join = JOIN_LABELS[a.join as JoinStyle] ?? a.join;
  return `${list?.label ?? a.list} · ${item?.label ?? a.itemPath} · ${join}`;
}

export type FieldOptions = { onEditField?: (pos: number) => void };

/** The list of the nearest enclosing `repeat`, if any. */
function enclosingRepeatList(props: NodeViewProps): string | null {
  const pos = props.getPos();
  if (typeof pos !== "number") return null;
  const $pos = props.editor.state.doc.resolve(pos);
  for (let d = $pos.depth; d > 0; d--) {
    const n: PMNode = $pos.node(d);
    if (n.type.name === "repeat") return String(n.attrs.list);
  }
  return null;
}

const chipClass = (selected: boolean, bad: boolean) =>
  cn(
    "inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] leading-none align-baseline cursor-pointer select-none",
    bad
      ? "border-red-300 bg-red-50 text-red-700"
      : "border-brand-500/30 bg-brand-500/10 text-brand-700",
    selected && "ring-2 ring-brand-500/40",
  );

function FieldView(props: NodeViewProps) {
  const { path, format } = props.node.attrs as { path: string; format: string | null };
  const repeatList = enclosingRepeatList(props);
  const unknown = !resolveField(path, repeatList);
  const onEdit = (props.extension.options as FieldOptions).onEditField;
  return (
    <NodeViewWrapper
      as="span"
      data-field-chip=""
      data-invalid={unknown ? "" : undefined}
      contentEditable={false}
      className={chipClass(props.selected, unknown)}
      onClick={() => {
        const pos = props.getPos();
        if (typeof pos === "number") onEdit?.(pos);
      }}
    >
      {fieldChipText(path, format, repeatList)}
    </NodeViewWrapper>
  );
}

function ListFieldView(props: NodeViewProps) {
  const a = props.node.attrs as { list: string; itemPath: string; join: string };
  const unknown = !listByPath(a.list);
  const onEdit = (props.extension.options as FieldOptions).onEditField;
  return (
    <NodeViewWrapper
      as="span"
      data-list-field-chip=""
      data-invalid={unknown ? "" : undefined}
      contentEditable={false}
      className={chipClass(props.selected, unknown)}
      onClick={() => {
        const pos = props.getPos();
        if (typeof pos === "number") onEdit?.(pos);
      }}
    >
      {listFieldChipText(a)}
    </NodeViewWrapper>
  );
}

export const FieldNode = Node.create<FieldOptions>({
  name: "field",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addOptions: () => ({}),
  addAttributes() {
    return {
      path: { default: "" },
      format: { default: null },
    };
  },
  parseHTML: () => [{ tag: "span[data-field]" }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "span",
    mergeAttributes(HTMLAttributes, { "data-field": "" }),
    fieldChipText(node.attrs.path, node.attrs.format),
  ],
  addNodeView: () => ReactNodeViewRenderer(FieldView),
  addCommands() {
    return {
      insertField:
        (path, format = null) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { path, format } }),
    };
  },
});

export const ListFieldNode = Node.create<FieldOptions>({
  name: "listField",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addOptions: () => ({}),
  addAttributes() {
    return {
      list: { default: "" },
      itemPath: { default: "" },
      join: { default: "and" },
    };
  },
  parseHTML: () => [{ tag: "span[data-list-field]" }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "span",
    mergeAttributes(HTMLAttributes, { "data-list-field": "" }),
    listFieldChipText(node.attrs as { list: string; itemPath: string; join: string }),
  ],
  addNodeView: () => ReactNodeViewRenderer(ListFieldView),
  addCommands() {
    return {
      insertListField:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    field: {
      insertField: (path: string, format?: string | null) => ReturnType;
    };
    listField: {
      insertListField: (attrs: { list: string; itemPath: string; join: JoinStyle }) => ReturnType;
    };
  }
}
