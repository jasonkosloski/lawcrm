"use client";

/**
 * Logic sections: `showIf` (conditional), `repeat` (loop over a list)
 * and its optional trailing `repeatEmpty` ("If none:") branch. Each
 * renders a non-editable header strip above editable block content.
 */

import { Node } from "@tiptap/core";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { cn } from "@/lib/utils";
import { listByPath } from "@/lib/templates/catalog";
import type { ShowIfOp } from "@/lib/templates/schema";
import { pathLabel } from "./labels";

export type SectionOptions = {
  /** Allowed block alternatives, e.g. "paragraph|heading|...". */
  blocks: string;
  onEditRule?: (pos: number) => void;
};

export function ruleHeaderText(a: {
  path: string;
  op: ShowIfOp | string;
  values: string[];
}): string {
  const label = pathLabel(a.path);
  switch (a.op) {
    case "present":
      return `Show if: ${label} is filled in`;
    case "empty":
      return `Show if: ${label} is empty`;
    case "true":
      return `Show if: ${label} is yes`;
    case "false":
      return `Show if: ${label} is no`;
    default:
      return `Show if: ${label} is one of ${(a.values ?? []).join(", ")}`;
  }
}

export function repeatHeaderText(list: string): string {
  return `Repeat for each: ${listByPath(list)?.label ?? list}`;
}

export const REPEAT_EMPTY_HEADER = "If none:";

function Header({
  text,
  invalid,
  onClick,
  tone,
}: {
  text: string;
  invalid?: boolean;
  onClick?: () => void;
  tone: "rule" | "empty";
}) {
  return (
    <div
      contentEditable={false}
      data-rule-header=""
      onClick={onClick}
      className={cn(
        "select-none px-2 py-1 text-[11px] font-medium",
        onClick && "cursor-pointer",
        invalid
          ? "bg-red-50 text-red-700"
          : tone === "rule"
            ? "bg-paper-2 text-ink-3"
            : "bg-paper-2 text-ink-4",
      )}
    >
      {text}
    </div>
  );
}

function ShowIfView(props: NodeViewProps) {
  const a = props.node.attrs as { path: string; op: string; values: string[] };
  const onEdit = (props.extension.options as SectionOptions).onEditRule;
  return (
    <NodeViewWrapper
      data-show-if=""
      className={cn(
        "my-2 rounded border border-dashed border-line-2",
        props.selected && "ring-2 ring-brand-500/40",
      )}
    >
      <Header
        tone="rule"
        text={ruleHeaderText(a)}
        onClick={
          onEdit
            ? () => {
                const pos = props.getPos();
                if (typeof pos === "number") onEdit(pos);
              }
            : undefined
        }
      />
      <NodeViewContent className="px-2 py-1" />
    </NodeViewWrapper>
  );
}

function RepeatView(props: NodeViewProps) {
  const list = String(props.node.attrs.list);
  const onEdit = (props.extension.options as SectionOptions).onEditRule;
  return (
    <NodeViewWrapper
      data-repeat=""
      className={cn(
        "my-2 rounded border border-dashed border-line-2",
        props.selected && "ring-2 ring-brand-500/40",
      )}
    >
      <Header
        tone="rule"
        invalid={!listByPath(list)}
        text={repeatHeaderText(list)}
        onClick={
          onEdit
            ? () => {
                const pos = props.getPos();
                if (typeof pos === "number") onEdit(pos);
              }
            : undefined
        }
      />
      <NodeViewContent className="px-2 py-1" />
    </NodeViewWrapper>
  );
}

function RepeatEmptyView() {
  return (
    <NodeViewWrapper data-repeat-empty="" className="mt-1 border-t border-dashed border-line-2">
      <Header tone="empty" text={REPEAT_EMPTY_HEADER} />
      <NodeViewContent className="px-2 py-1" />
    </NodeViewWrapper>
  );
}

export const ShowIfNode = Node.create<SectionOptions>({
  name: "showIf",
  group: "block",
  defining: true,
  addOptions: () => ({ blocks: "paragraph" }),
  content() {
    return `(${this.options.blocks})+`;
  },
  addAttributes() {
    return {
      path: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-path") ?? "",
        renderHTML: (a: Record<string, unknown>) => ({ "data-path": String(a.path ?? "") }),
      },
      op: {
        default: "present",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-op") ?? "present",
        renderHTML: (a: Record<string, unknown>) => ({ "data-op": String(a.op ?? "present") }),
      },
      values: {
        default: [],
        parseHTML: (el: HTMLElement) => {
          try {
            const v: unknown = JSON.parse(el.getAttribute("data-values") ?? "[]");
            return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
          } catch {
            return [];
          }
        },
        renderHTML: (a: Record<string, unknown>) => ({
          "data-values": JSON.stringify(a.values ?? []),
        }),
      },
    };
  },
  parseHTML: () => [{ tag: "div[data-show-if]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", { ...HTMLAttributes, "data-show-if": "" }, 0],
  addNodeView: () => ReactNodeViewRenderer(ShowIfView),
  addCommands() {
    return {
      wrapInShowIf:
        (attrs) =>
        ({ commands }) =>
          commands.wrapIn(this.name, attrs),
    };
  },
});

export const RepeatNode = Node.create<SectionOptions>({
  name: "repeat",
  group: "block",
  defining: true,
  addOptions: () => ({ blocks: "paragraph" }),
  content() {
    return `(${this.options.blocks})+ repeatEmpty?`;
  },
  addAttributes() {
    return {
      list: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-list") ?? "",
        renderHTML: (a: Record<string, unknown>) => ({ "data-list": String(a.list ?? "") }),
      },
    };
  },
  parseHTML: () => [{ tag: "div[data-repeat]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", { ...HTMLAttributes, "data-repeat": "" }, 0],
  addNodeView: () => ReactNodeViewRenderer(RepeatView),
  addCommands() {
    return {
      wrapInRepeat:
        (list) =>
        ({ commands }) =>
          commands.wrapIn(this.name, { list }),
      /** Append an empty "If none:" branch to the repeat at `pos`. */
      addRepeatEmpty:
        (pos) =>
        ({ state, tr, dispatch }) => {
          const node = state.doc.nodeAt(pos);
          if (!node || node.type.name !== "repeat") return false;
          if (node.lastChild?.type.name === "repeatEmpty") return false;
          const empty = state.schema.nodes.repeatEmpty.createAndFill();
          if (!empty) return false;
          if (dispatch) dispatch(tr.insert(pos + node.nodeSize - 1, empty));
          return true;
        },
    };
  },
});

export const RepeatEmptyNode = Node.create<SectionOptions>({
  name: "repeatEmpty",
  defining: true,
  addOptions: () => ({ blocks: "paragraph" }),
  content() {
    return `(${this.options.blocks})*`;
  },
  parseHTML: () => [{ tag: "div[data-repeat-empty]" }],
  renderHTML: () => ["div", { "data-repeat-empty": "" }, 0],
  addNodeView: () => ReactNodeViewRenderer(RepeatEmptyView),
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    showIf: {
      wrapInShowIf: (attrs: { path: string; op: ShowIfOp; values: string[] }) => ReturnType;
    };
    repeat: {
      wrapInRepeat: (list: string) => ReturnType;
      addRepeatEmpty: (pos: number) => ReturnType;
    };
    templateNodes: {
      updateNodeAttrs: (pos: number, attrs: Record<string, unknown>) => ReturnType;
    };
  }
}
