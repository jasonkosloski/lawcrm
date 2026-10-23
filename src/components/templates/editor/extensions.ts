/**
 * The template editor's TipTap extension set. The node names and attrs
 * are the contract in `src/lib/templates/schema.ts`: the editor must
 * emit JSON that `validateTemplateContent` accepts and load any valid
 * JSON losslessly. Only schema-allowed nodes and marks are registered,
 * so paste/setContent of anything else is dropped by ProseMirror.
 */

import { Extension, mergeAttributes, type Editor, type Extensions } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import { ListItem, OrderedList } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow, TableView } from "@tiptap/extension-table";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import Paragraph from "@tiptap/extension-paragraph";
import TextAlign from "@tiptap/extension-text-align";
import StarterKit from "@tiptap/starter-kit";
import {
  CELL_SIDES,
  type CellBorders,
  type ParagraphAttrs,
  type ParagraphSettingKey,
  type TemplateDoc,
  type TemplateKind,
} from "@/lib/templates/schema";
import type { ParagraphStyle } from "@/lib/templates/paragraph-styles";
import {
  lineFactor,
  resolveParagraph,
  type ParagraphSettings as StyleSettings,
} from "@/lib/templates/resolve-styles";
import type { BlockSource } from "@/lib/templates/render";
import { CELL_SIDE_ATTR } from "@/lib/templates/table-layout";
import { BlockNode } from "./block-node";
import { FieldNode, ListFieldNode } from "./field-node";
import { PageBreak } from "./page-break";
import { RepeatEmptyNode, RepeatNode, ShowIfNode } from "./section-nodes";
import { SmallCaps } from "./small-caps";
import { AllCaps, FontSize } from "./text-marks";
import { fillColumnWidths } from "@/components/editor/table-commands";

export type TemplateExtensionOptions = {
  /** The firm's paragraph styles: the editor draws each paragraph in its effective look. */
  styles: ParagraphStyle[];
  kind: TemplateKind;
  isBlock: boolean;
  blocks: BlockSource[];
  onEditBlock?: (id: string) => void;
  onEditRule?: (pos: number) => void;
  onEditField?: (pos: number) => void;
};

/** Direct paragraph settings, in the content's attribute names. */
export type ParagraphSettings = Pick<ParagraphAttrs, "textAlign" | ParagraphSettingKey>;

/** Each direct setting's `data-*` attribute and how it travels as text. */
const SETTING_DATA: Record<ParagraphSettingKey, { attr: string; json: boolean }> = {
  spaceBeforePt: { attr: "data-space-before", json: false },
  spaceAfterPt: { attr: "data-space-after", json: false },
  lineSpacing: { attr: "data-line-spacing", json: true },
  indentLeftIn: { attr: "data-indent-left", json: false },
  indentRightIn: { attr: "data-indent-right", json: false },
  firstLine: { attr: "data-first-line", json: true },
  keepWithNext: { attr: "data-keep-next", json: true },
  keepLinesTogether: { attr: "data-keep-lines", json: true },
  pageBreakBefore: { attr: "data-page-break", json: true },
};
const SETTING_KEYS = Object.keys(SETTING_DATA) as ParagraphSettingKey[];
/** Everything `clearFormatting` resets: the settings and the alignment. */
const CLEARED = Object.fromEntries([...SETTING_KEYS, "textAlign"].map((k) => [k, null]));

function settingAttribute(key: ParagraphSettingKey) {
  const { attr, json } = SETTING_DATA[key];
  return {
    default: null,
    // Values are JSON text (numbers, booleans, objects); absent means unset.
    parseHTML: (el: HTMLElement) => {
      const raw = el.getAttribute(attr);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return null;
      }
    },
    renderHTML: (a: Record<string, unknown>) => {
      const v = a[key];
      return v === null || v === undefined ? {} : { [attr]: json ? JSON.stringify(v) : String(v) };
    },
  };
}

/** The effective look of a paragraph, as inline CSS, so the editor matches the output. */
function paragraphCss(styles: ParagraphStyle[], attrs: Record<string, unknown>): string {
  const settings: StyleSettings = {};
  for (const k of SETTING_KEYS) {
    if (attrs[k] !== null && attrs[k] !== undefined) {
      (settings as Record<string, unknown>)[k] = attrs[k];
    }
  }
  if (attrs.textAlign) settings.align = attrs.textAlign as StyleSettings["align"];
  const key = typeof attrs.style === "string" ? attrs.style : undefined;
  const r = resolveParagraph(key, settings, styles);
  const factor = lineFactor(r.lineSpacing);
  const css: string[] = [
    `font-size:${String(r.sizePt)}pt`,
    // Weight, slant and the like go through custom properties (BODY_CLASS
    // reads them): a literal font-weight on a <p> would parse back as a bold mark.
    `--p-weight:${r.bold ? "bold" : "normal"}`,
    `--p-style:${r.italic ? "italic" : "normal"}`,
    `--p-case:${r.allCaps ? "uppercase" : "none"}`,
    `--p-variant:${r.smallCaps ? "small-caps" : "normal"}`,
    `--p-deco:${r.underline ? "underline" : "none"}`,
    `text-align:${r.align}`,
    `margin-top:${String(r.spaceBeforePt)}pt`,
    `margin-bottom:${String(r.spaceAfterPt)}pt`,
    `margin-left:${String(r.indentLeftIn)}in`,
    `margin-right:${String(r.indentRightIn)}in`,
    `line-height:${factor === null ? `${String((r.lineSpacing as { exactPt: number }).exactPt)}pt` : String(factor)}`,
  ];
  if (r.firstLine.kind !== "none") {
    const sign = r.firstLine.kind === "hanging" ? "-" : "";
    css.push(`text-indent:${sign}${String(r.firstLine.in)}in`);
  }
  return css.join(";");
}

/** A paragraph with a style key and direct settings. Its HTML carries them as
 *  data-* (lossless copy/paste) plus an inline style for display only. */
const createParagraph = (styles: ParagraphStyle[]) =>
  Paragraph.extend({
    addAttributes() {
      return {
        style: {
          default: null,
          parseHTML: (el: HTMLElement) => el.getAttribute("data-style"),
          renderHTML: (a: { style?: string | null }) => (a.style ? { "data-style": a.style } : {}),
        },
        ...Object.fromEntries(SETTING_KEYS.map((k) => [k, settingAttribute(k)])),
      };
    },
    renderHTML({ node, HTMLAttributes }) {
      return ["p", mergeAttributes(HTMLAttributes, { style: paragraphCss(styles, node.attrs) }), 0];
    },
  });

/** Paragraph commands and clear formatting. */
const ParagraphCommands = Extension.create({
  name: "paragraphCommands",
  addCommands() {
    return {
      setParagraphStyle:
        (key) =>
        ({ commands }) =>
          commands.updateAttributes("paragraph", { style: key === "body" ? null : key }),
      setParagraphSettings:
        (s) =>
        ({ commands }) =>
          commands.updateAttributes(
            "paragraph",
            Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v ?? null])),
          ),
      clearFormatting:
        () =>
        ({ chain }) =>
          chain().unsetAllMarks().updateAttributes("paragraph", CLEARED).run(),
    };
  },
});

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
  stripUnsetParagraphAttrs(JSON.parse(JSON.stringify(editor.getJSON()))) as TemplateDoc;

/** Unset (null) paragraph style and settings are left out: the content
 *  contract says absent, and renderers read the JSON before validation. */
function stripUnsetParagraphAttrs(node: {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: unknown[];
}): unknown {
  if (node.type === "paragraph" && node.attrs) {
    for (const k of ["style", ...SETTING_KEYS]) if (node.attrs[k] === null) delete node.attrs[k];
  }
  node.content?.forEach((c) => stripUnsetParagraphAttrs(c as typeof node));
  return node;
}

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
      heading: false,
      paragraph: false,
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
    createParagraph(opts.styles),
    // Alignment travels as data-align; the inline display style never parses back.
    TextAlign.extend({
      addGlobalAttributes() {
        return [
          {
            types: this.options.types,
            attributes: {
              textAlign: {
                default: null,
                parseHTML: (el: HTMLElement) => el.getAttribute("data-align"),
                renderHTML: (a: { textAlign?: string | null }) =>
                  a.textAlign ? { "data-align": a.textAlign } : {},
              },
            },
          },
        ];
      },
    }).configure({ types: ["paragraph"] }),
    ParagraphCommands,
    SmallCaps,
    AllCaps,
    FontSize,
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
      ? [
          BlockNode.configure({
            blocks: opts.blocks,
            styles: opts.styles,
            onEditBlock: opts.onEditBlock,
          }),
        ]
      : []),
    ShowIfNode.configure(sectionOpts),
    RepeatNode.configure(sectionOpts),
    RepeatEmptyNode.configure(sectionOpts),
    UpdateNodeAttrs,
  ];
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    paragraphCommands: {
      /** Gives the selected paragraphs a style (by key); "body" is the unset default. */
      setParagraphStyle: (key: string) => ReturnType;
      /** Sets direct settings; null/undefined clears one. */
      setParagraphSettings: (s: {
        [K in keyof ParagraphSettings]?: ParagraphSettings[K] | null;
      }) => ReturnType;
      /** Removes all marks and all direct settings; keeps the style. */
      clearFormatting: () => ReturnType;
    };
  }
}
