/**
 * The template editor's TipTap extension set. The node names and attrs
 * are the contract in `src/lib/templates/schema.ts`: the editor must
 * emit JSON that `validateTemplateContent` accepts and load any valid
 * JSON losslessly. Only schema-allowed nodes and marks are registered,
 * so paste/setContent of anything else is dropped by ProseMirror.
 */

import { Extension, type Editor, type Extensions } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import { ListItem, OrderedList } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow, TableView } from "@tiptap/extension-table";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import TextAlign from "@tiptap/extension-text-align";
import StarterKit from "@tiptap/starter-kit";
import {
  CELL_SIDES,
  type CellBorders,
  type TemplateDoc,
  type TemplateKind,
} from "@/lib/templates/schema";
import type { BlockSource } from "@/lib/templates/render";
import { CELL_SIDE_ATTR } from "@/lib/templates/table-layout";
import { BlockNode } from "./block-node";
import { FieldNode, ListFieldNode } from "./field-node";
import { PageBreak } from "./page-break";
import { RepeatEmptyNode, RepeatNode, ShowIfNode } from "./section-nodes";
import { SmallCaps } from "./small-caps";
import { fillColumnWidths } from "./table-commands";

export type TemplateExtensionOptions = {
  kind: TemplateKind;
  isBlock: boolean;
  blocks: BlockSource[];
  onEditBlock?: (id: string) => void;
  onEditRule?: (pos: number) => void;
  onEditField?: (pos: number) => void;
};

/** A removed side shows as a faint dashed guide while editing. */
const SIDE_STYLE = {
  none: (side: string) => `border-${side}:1px dashed #d4d4d8;`,
  thick: (side: string) => `border-${side}:2px solid #000;`,
};

/** Table cells carry only the attrs the schema allows (no `align`). */
const cellAttrs = {
  addAttributes(this: { parent?: () => Record<string, unknown> }) {
    const parent = this.parent?.() ?? {};
    return {
      colspan: parent.colspan,
      rowspan: parent.rowspan,
      colwidth: parent.colwidth,
      verticalAlign: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-valign"),
        renderHTML: (a: { verticalAlign?: string | null }) =>
          a.verticalAlign
            ? { "data-valign": a.verticalAlign, style: `vertical-align:${a.verticalAlign};` }
            : {},
      },
      borders: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const b: CellBorders = {};
          for (const side of CELL_SIDES) {
            const v = el.getAttribute(CELL_SIDE_ATTR[side]);
            if (v === "none" || v === "thick") b[side] = v;
          }
          return Object.keys(b).length ? b : null;
        },
        renderHTML: (a: { borders?: CellBorders | null }) => {
          const out: Record<string, string> = {};
          let style = "";
          for (const side of CELL_SIDES) {
            const w = a.borders?.[side];
            if (!w) continue;
            out[CELL_SIDE_ATTR[side]] = w;
            style += SIDE_STYLE[w](side);
          }
          return style ? { ...out, style } : out;
        },
      },
    };
  },
};

/** Full-width tables span the editor; fit tables shrink to content. */
class TemplateTableView extends TableView {
  constructor(...args: ConstructorParameters<typeof TableView>) {
    super(...args);
    this.markWidth(args[0]);
  }
  update(node: PMNode) {
    const ok = super.update(node);
    if (ok) this.markWidth(node);
    return ok;
  }
  private markWidth(node: PMNode) {
    this.table.dataset.width = node.attrs.width === "fit" ? "fit" : "full";
  }
}

/**
 * The editor's doc as plain JSON. ProseMirror shares one null-prototype
 * `attrs` object across nodes with default attrs, which server actions
 * refuse to serialize, so anything sent to the server goes through this.
 */
export const templateJSON = (editor: Editor): TemplateDoc =>
  JSON.parse(JSON.stringify(editor.getJSON())) as TemplateDoc;

/** Keeps table column widths complete once any column is resized. */
const FillColumnWidths = Extension.create({
  name: "fillColumnWidths",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        view: () => ({
          update(view) {
            const tr = fillColumnWidths(view.state, (pos) => {
              const el = view.nodeDOM(pos);
              return el instanceof HTMLElement ? el.getBoundingClientRect().width : null;
            });
            if (tr) view.dispatch(tr);
          },
        }),
      }),
    ];
  },
});

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
    SmallCaps,
    Table.extend({
      addAttributes() {
        return {
          width: {
            default: null,
            parseHTML: (el: HTMLElement) =>
              el.getAttribute("data-width") === "fit" ? "fit" : null,
            renderHTML: (a: { width?: string | null }) => ({ "data-width": a.width ?? "full" }),
          },
        };
      },
    }).configure({ resizable: true, View: TemplateTableView }),
    TableRow,
    TableHeader.extend({ content: `(${blocks})+`, ...cellAttrs }),
    TableCell.extend({ content: `(${blocks})+`, ...cellAttrs }),
    FillColumnWidths,
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
