/**
 * The template editor's TipTap extension set. The node names and attrs
 * are the contract in `src/lib/templates/schema.ts`: the editor must
 * emit JSON that `validateTemplateContent` accepts and load any valid
 * JSON losslessly. Only schema-allowed nodes and marks are registered,
 * so paste/setContent of anything else is dropped by ProseMirror.
 */

import { Extension, type Extensions } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import { ListItem, OrderedList } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import StarterKit from "@tiptap/starter-kit";
import type { TemplateKind } from "@/lib/templates/schema";
import type { BlockSource } from "@/lib/templates/render";
import { BlockNode } from "./block-node";
import { FieldNode, ListFieldNode } from "./field-node";
import { PageBreak } from "./page-break";
import { RepeatEmptyNode, RepeatNode, ShowIfNode } from "./section-nodes";

export type TemplateExtensionOptions = {
  kind: TemplateKind;
  isBlock: boolean;
  blocks: BlockSource[];
  onEditBlock?: (id: string) => void;
  onEditRule?: (pos: number) => void;
  onEditField?: (pos: number) => void;
};

/** Table cells carry only the attrs the schema allows (no `align`). */
const withoutAlign = {
  addAttributes(this: { parent?: () => Record<string, unknown> }) {
    const parent = this.parent?.() ?? {};
    return { colspan: parent.colspan, rowspan: parent.rowspan, colwidth: parent.colwidth };
  },
};

/** Generic node-attribute updater used by the property dialogs. */
const UpdateNodeAttrs = Extension.create({
  name: "updateNodeAttrs",
  addCommands() {
    return {
      updateNodeAttrs:
        (pos, attrs) =>
        ({ state, tr, dispatch }) => {
          const node = state.doc.nodeAt(pos);
          if (!node) return false;
          if (dispatch) dispatch(tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }));
          return true;
        },
    };
  },
});

export function createTemplateExtensions(opts: TemplateExtensionOptions): Extensions {
  const { kind } = opts;
  const field = FieldNode.configure({ onEditField: opts.onEditField });

  if (kind === "sms") {
    // Plain text with merge fields only: no formatting, lists or sections.
    return [
      Document.extend({ content: "paragraph+" }),
      StarterKit.configure({
        document: false,
        bold: false,
        italic: false,
        underline: false,
        strike: false,
        code: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        heading: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
        link: false,
        dropcursor: false,
        gapcursor: false,
        trailingNode: false,
      }),
      field,
    ];
  }

  const hasBlockRef = !opts.isBlock;
  const hasPageBreak = kind !== "email";
  // Explicit alternatives, not the "block" group: the schema's `block`
  // node would shadow that group name in content expressions.
  const blocks = [
    "paragraph",
    "heading",
    "bulletList",
    "orderedList",
    "table",
    ...(hasPageBreak ? ["pageBreak"] : []),
    ...(hasBlockRef ? ["block"] : []),
    "showIf",
    "repeat",
  ].join("|");
  const sectionOpts = { blocks, onEditRule: opts.onEditRule };

  return [
    Document.extend({ content: `(${blocks})+` }),
    StarterKit.configure({
      document: false,
      heading: { levels: [1, 2, 3] },
      listItem: false,
      orderedList: false,
      horizontalRule: false,
      code: false,
      codeBlock: false,
      blockquote: false,
      strike: false,
      link: false,
      trailingNode: false,
    }),
    ListItem.extend({ content: `(${blocks})+` }),
    // The schema keeps only `start` (not TipTap's `type`).
    OrderedList.extend({
      addAttributes() {
        const parent = (this.parent?.() ?? {}) as { start?: unknown };
        return { start: parent.start };
      },
    }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader.extend({ content: `(${blocks})+`, ...withoutAlign }),
    TableCell.extend({ content: `(${blocks})+`, ...withoutAlign }),
    field,
    ListFieldNode.configure({ onEditField: opts.onEditField }),
    ...(hasPageBreak ? [PageBreak] : []),
    ...(hasBlockRef
      ? [BlockNode.configure({ blocks: opts.blocks, onEditBlock: opts.onEditBlock })]
      : []),
    ShowIfNode.configure(sectionOpts),
    RepeatNode.configure(sectionOpts),
    RepeatEmptyNode.configure(sectionOpts),
    UpdateNodeAttrs,
  ];
}
