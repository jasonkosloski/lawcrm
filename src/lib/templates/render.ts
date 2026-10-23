/**
 * Render engine: turns a structured template plus data into plain prose
 * (a ResolvedDoc with no field/listField/block/showIf/repeat nodes) and a
 * report of what was missing. Never throws on bad template content:
 * problems become visible placeholders and report entries.
 */

import {
  fieldByPath,
  listByPath,
  type CatalogField,
  type CatalogList,
  type FieldFormat,
  type ListItem,
  type TemplateData,
} from "./catalog";
import { MAX_BLOCK_DEPTH } from "./block-graph";
import { formatFieldValue, joinList } from "./format";
import { convertHeadings } from "./headings";
import type { ParagraphStyle } from "./paragraph-styles";
import {
  resolveParagraph,
  type ParagraphSettings,
  type ResolvedParagraphStyle,
} from "./resolve-styles";
import type {
  AppliesTo,
  BlockNode,
  FieldNode,
  InlineNode,
  ListFieldNode,
  MarkType,
  ParagraphAttrs,
  ShowIfNode,
  TableCellNode,
  TableNode,
  TemplateDoc,
  TemplateMark,
  TextAlign,
} from "./schema";

/** `appliesTo` absent means "both". */
export type BlockSource = {
  id: string;
  name: string;
  isActive: boolean;
  content: TemplateDoc;
  appliesTo?: AppliesTo;
};

export type RenderReport = {
  /** Labels of fields with no value. */
  missing: string[];
  /** Labels of fields with no value set to print nothing ("Leave blank").
   *  Shown to the author while editing; not a warning when generating. */
  blank: string[];
  /** Paths that are unknown, out of scope, or `item.*` outside a repeat. */
  invalid: string[];
  /** Names of archived blocks; "(deleted)" for unknown ids. */
  archivedBlocks: string[];
  /** Style keys that name no style in the firm's list (they render as Body). */
  unknownStyles: string[];
};

// ── Output types ───────────────────────────────────────────────────────

export type ResolvedMark = { type: MarkType | "missing"; attrs?: { pt: number } };
export type ResolvedText = { type: "text"; text: string; marks?: ResolvedMark[] };
export type ResolvedHardBreak = { type: "hardBreak" };
export type ResolvedInline = ResolvedText | ResolvedHardBreak;

export type ResolvedParagraph = {
  type: "paragraph";
  /** The content's own attrs plus the finished style values. `resolved` is
   *  always set by the render engine; hand-built docs may omit it. */
  attrs?: ParagraphAttrs & { resolved?: ResolvedParagraphStyle };
  content?: ResolvedInline[];
};
/** No longer produced (the engine turns headings into heading1..3
 *  paragraphs); kept so converters and hand-built docs still compile. */
export type ResolvedHeading = {
  type: "heading";
  attrs: { level: 1 | 2 | 3; textAlign?: TextAlign | null };
  content?: ResolvedInline[];
};
export type ResolvedListItem = { type: "listItem"; content: ResolvedBlock[] };
export type ResolvedBulletList = { type: "bulletList"; content: ResolvedListItem[] };
export type ResolvedOrderedList = { type: "orderedList"; content: ResolvedListItem[] };
export type ResolvedTableCell = {
  type: "tableCell" | "tableHeader";
  attrs?: TableCellNode["attrs"];
  content: ResolvedBlock[];
};
export type ResolvedTableRow = { type: "tableRow"; content: ResolvedTableCell[] };
export type ResolvedTable = {
  type: "table";
  attrs?: TableNode["attrs"];
  content: ResolvedTableRow[];
};
export type ResolvedPageBreak = { type: "pageBreak" };

export type ResolvedBlock =
  | ResolvedParagraph
  | ResolvedHeading
  | ResolvedBulletList
  | ResolvedOrderedList
  | ResolvedTable
  | ResolvedPageBreak;

export type ResolvedDoc = { type: "doc"; content?: ResolvedBlock[] };

export type ResolvedNode =
  | ResolvedDoc
  | ResolvedBlock
  | ResolvedInline
  | ResolvedListItem
  | ResolvedTableRow
  | ResolvedTableCell;

// ── Engine ─────────────────────────────────────────────────────────────

type Scope = {
  item: ListItem | null;
  itemFields: CatalogField[];
  /** Ids of the blocks being expanded, outermost first (the loop and
   *  depth guards). */
  chain: string[];
};

type Engine = {
  data: TemplateData;
  blocks: Map<string, BlockSource>;
  report: RenderReport;
  styles: ParagraphStyle[];
  /** Count of empty fields left blank so far (lets a paragraph tell it
   *  was emptied by them). */
  blanked: number;
};

const MISSING: ResolvedMark = { type: "missing" };

const note = (list: string[], v: string) => {
  if (!list.includes(v)) list.push(v);
};

type Lookup = { field: CatalogField; item: ListItem | null } | null;

/** Resolve a field path in the current scope, or null when invalid. */
function lookup(e: Engine, path: string, s: Scope): Lookup {
  if (path.startsWith("item.")) {
    if (!s.item) return null;
    const sub = path.slice("item.".length);
    const field = s.itemFields.find((f) => f.path === sub);
    return field ? { field, item: s.item } : null;
  }
  const field = fieldByPath(path);
  if (!field || !field.scopes.includes(e.data.scope)) return null;
  return { field, item: null };
}

function textNodes(text: string, marks: ResolvedMark[]): ResolvedInline[] {
  const out: ResolvedInline[] = [];
  text.split("\n").forEach((line, i) => {
    if (i > 0) out.push({ type: "hardBreak" });
    if (line)
      out.push(marks.length ? { type: "text", text: line, marks } : { type: "text", text: line });
  });
  return out;
}

const marksOf = (n: { marks?: TemplateMark[] }): ResolvedMark[] =>
  (n.marks ?? []).map((m) =>
    m.type === "fontSize" ? { type: m.type, attrs: m.attrs } : { type: m.type },
  );

function formatOf(field: CatalogField, requested: string | null): FieldFormat | null {
  return requested && field.formats.includes(requested as FieldFormat)
    ? (requested as FieldFormat)
    : null;
}

function formatted(e: Engine, l: NonNullable<Lookup>, requested: string | null): string | null {
  const value = l.field.get(e.data, l.item ?? undefined);
  return formatFieldValue(l.field, value, formatOf(l.field, requested), e.data.timeZone);
}

function field(e: Engine, n: FieldNode, s: Scope): ResolvedInline[] {
  const marks = marksOf(n);
  const l = lookup(e, n.attrs.path, s);
  if (!l) {
    note(e.report.invalid, n.attrs.path);
    return textNodes(`{{${n.attrs.path}}}`, [...marks, MISSING]);
  }
  const text = formatted(e, l, n.attrs.format);
  if (text === null) {
    if (n.attrs.ifMissing === "hide") {
      note(e.report.blank, l.field.label);
      e.blanked++;
      return [];
    }
    note(e.report.missing, l.field.label);
    return textNodes(`[${l.field.label} — not on file]`, [...marks, MISSING]);
  }
  return textNodes(text, marks);
}

function listField(e: Engine, n: ListFieldNode): ResolvedInline[] {
  const marks = marksOf(n);
  const list: CatalogList | undefined = listByPath(n.attrs.list);
  const valid = list && list.scopes.includes(e.data.scope);
  const itemField = valid ? list.itemFields.find((f) => f.path === n.attrs.itemPath) : undefined;
  if (!list || !valid || !itemField) {
    const bad = valid ? `${n.attrs.list}.${n.attrs.itemPath}` : n.attrs.list;
    note(e.report.invalid, bad);
    return textNodes(`{{${bad}}}`, [...marks, MISSING]);
  }
  const names = list
    .get(e.data)
    .map((item) => formatFieldValue(itemField, itemField.get(e.data, item), null, e.data.timeZone))
    .filter((v): v is string => v !== null);
  if (n.attrs.join === "lines") {
    return names.flatMap((name, i) => [
      ...(i > 0 ? [{ type: "hardBreak" } as const] : []),
      ...textNodes(name, marks),
    ]);
  }
  return textNodes(joinList(names, n.attrs.join), marks);
}

function inline(e: Engine, nodes: InlineNode[] | undefined, s: Scope): ResolvedInline[] {
  return (nodes ?? []).flatMap((n): ResolvedInline[] => {
    switch (n.type) {
      case "text":
        return n.text
          ? [{ type: "text", text: n.text, ...(n.marks ? { marks: marksOf(n) } : {}) }]
          : [];
      case "hardBreak":
        return [{ type: "hardBreak" }];
      case "field":
        return field(e, n, s);
      case "listField":
        return listField(e, n);
    }
  });
}

function showIfKeeps(e: Engine, n: ShowIfNode, s: Scope): boolean {
  const l = lookup(e, n.attrs.path, s);
  if (!l) {
    note(e.report.invalid, n.attrs.path);
    return false;
  }
  switch (n.attrs.op) {
    case "present":
      return formatted(e, l, null) !== null;
    case "empty":
      return formatted(e, l, null) === null;
    case "true":
      return l.field.get(e.data, l.item ?? undefined) === true;
    case "false":
      return l.field.get(e.data, l.item ?? undefined) === false;
    case "in": {
      const v = formatted(e, l, "as_is");
      if (v === null) return false;
      const want = v.trim().toLowerCase();
      return n.attrs.values.some((x) => x.trim().toLowerCase() === want);
    }
  }
}

/** Finished style values for a paragraph: its style, then its own settings
 *  on top. Explicit 0/false/none settings are overrides, so only
 *  `undefined` (and a null alignment) means "not set". */
function resolveAttrs(
  e: Engine,
  attrs: ParagraphAttrs | undefined,
): NonNullable<ResolvedParagraph["attrs"]> {
  const a = attrs ?? {};
  const settings: ParagraphSettings = {};
  if (a.textAlign != null) settings.align = a.textAlign;
  if (a.spaceBeforePt !== undefined) settings.spaceBeforePt = a.spaceBeforePt;
  if (a.spaceAfterPt !== undefined) settings.spaceAfterPt = a.spaceAfterPt;
  if (a.lineSpacing !== undefined) settings.lineSpacing = a.lineSpacing;
  if (a.indentLeftIn !== undefined) settings.indentLeftIn = a.indentLeftIn;
  if (a.indentRightIn !== undefined) settings.indentRightIn = a.indentRightIn;
  if (a.firstLine !== undefined) settings.firstLine = a.firstLine;
  if (a.keepWithNext !== undefined) settings.keepWithNext = a.keepWithNext;
  if (a.keepLinesTogether !== undefined) settings.keepLinesTogether = a.keepLinesTogether;
  if (a.pageBreakBefore !== undefined) settings.pageBreakBefore = a.pageBreakBefore;
  const resolved = resolveParagraph(a.style, settings, e.styles);
  if (a.style !== undefined && !resolved.known) note(e.report.unknownStyles, a.style);
  return { ...a, resolved };
}

function placeholder(e: Engine, text: string): ResolvedParagraph {
  return {
    type: "paragraph",
    attrs: resolveAttrs(e, undefined),
    content: [{ type: "text", text, marks: [MISSING] }],
  };
}

function blockRef(e: Engine, blockId: string, s: Scope): ResolvedBlock[] {
  const src = e.blocks.get(blockId);
  if (!src) {
    note(e.report.archivedBlocks, "(deleted)");
    return [placeholder(e, "[Missing block]")];
  }
  if (!src.isActive) {
    note(e.report.archivedBlocks, src.name);
    return [placeholder(e, `[${src.name} block — archived]`)];
  }
  if (s.chain.includes(blockId)) {
    note(e.report.invalid, `${src.name} (includes itself)`);
    return [placeholder(e, "[Block includes itself]")];
  }
  if (s.chain.length === MAX_BLOCK_DEPTH) {
    note(e.report.invalid, `${src.name} (nested too deep)`);
    return [placeholder(e, "[Blocks nested too deep]")];
  }
  return blocks(e, convertHeadings(src.content).content, { ...s, chain: [...s.chain, blockId] });
}

function blocks(e: Engine, nodes: readonly BlockNode[] | undefined, s: Scope): ResolvedBlock[] {
  return (nodes ?? []).flatMap((n): ResolvedBlock[] => {
    switch (n.type) {
      case "paragraph": {
        const before = e.blanked;
        const content = inline(e, n.content, s);
        // A line that is empty only because its fields were left blank
        // goes away, so optional lines (e.g. address line 2) leave no gap.
        if (e.blanked > before && content.every((c) => c.type !== "text" || !c.text.trim())) {
          return [];
        }
        return [
          {
            type: "paragraph",
            attrs: resolveAttrs(e, n.attrs),
            ...(content.length ? { content } : {}),
          },
        ];
      }
      case "heading": {
        const content = inline(e, n.content, s);
        return [{ type: "heading", attrs: n.attrs, ...(content.length ? { content } : {}) }];
      }
      case "bulletList":
      case "orderedList":
        return [
          {
            type: n.type,
            content: n.content.map((li) => ({
              type: "listItem" as const,
              content: blocks(e, li.content, s),
            })),
          },
        ];
      case "table":
        return [
          {
            type: "table",
            ...(n.attrs ? { attrs: n.attrs } : {}),
            content: n.content.map((row) => ({
              type: "tableRow" as const,
              content: row.content.map((cell) => ({
                type: cell.type,
                ...(cell.attrs ? { attrs: cell.attrs } : {}),
                content: blocks(e, cell.content, s),
              })),
            })),
          },
        ];
      case "pageBreak":
        return [{ type: "pageBreak" }];
      case "block":
        return blockRef(e, n.attrs.blockId, s);
      case "showIf":
        return showIfKeeps(e, n, s) ? blocks(e, n.content, s) : [];
      case "repeat": {
        const list = listByPath(n.attrs.list);
        if (!list || !list.scopes.includes(e.data.scope)) {
          note(e.report.invalid, n.attrs.list);
          return [];
        }
        const body = n.content.filter((c): c is BlockNode => c.type !== "repeatEmpty");
        const empty = n.content.find((c) => c.type === "repeatEmpty");
        const items = list.get(e.data);
        if (items.length === 0) {
          return empty && empty.type === "repeatEmpty" ? blocks(e, empty.content, s) : [];
        }
        return items.flatMap((item) =>
          blocks(e, body, { ...s, item, itemFields: list.itemFields }),
        );
      }
    }
  });
}

export function renderTemplate(
  doc: TemplateDoc,
  ctx: { data: TemplateData; blocks: Map<string, BlockSource>; styles: ParagraphStyle[] },
): { doc: ResolvedDoc; report: RenderReport } {
  const report: RenderReport = {
    missing: [],
    blank: [],
    invalid: [],
    archivedBlocks: [],
    unknownStyles: [],
  };
  const e: Engine = { data: ctx.data, blocks: ctx.blocks, report, styles: ctx.styles, blanked: 0 };
  const content = blocks(e, convertHeadings(doc).content, {
    item: null,
    itemFields: [],
    chain: [],
  });
  return { doc: content.length ? { type: "doc", content } : { type: "doc" }, report };
}
