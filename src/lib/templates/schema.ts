/**
 * Structured template content: TipTap/ProseMirror JSON with firm-specific
 * nodes (field, listField, block, showIf, repeat). This module is the
 * contract the render engine, editor and actions build on. Content arrives
 * from the client, so validation is total: it never throws and returns a
 * normalized copy (unknown attrs stripped) on success.
 */

export const TEMPLATE_KINDS = ["letter", "email", "sms", "filing"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export const APPLIES_TO = ["matter", "lead", "both"] as const;
export type AppliesTo = (typeof APPLIES_TO)[number];

export const MAX_CONTENT_BYTES = 256 * 1024;
export const MAX_DEPTH = 12;

export type TextAlign = "left" | "center" | "right" | "justify";
export const JOIN_STYLES = ["and", "oxford_and", "lines"] as const;
export type JoinStyle = (typeof JOIN_STYLES)[number];
export const SHOW_IF_OPS = ["present", "empty", "true", "false", "in"] as const;
export type ShowIfOp = (typeof SHOW_IF_OPS)[number];

export type MarkType = "bold" | "italic" | "underline";
export type TemplateMark = { type: MarkType };

export type TextNode = { type: "text"; text: string; marks?: TemplateMark[] };
export type HardBreakNode = { type: "hardBreak" };
export type FieldNode = {
  type: "field";
  // Narrowed to FieldFormat once catalog.ts defines it.
  attrs: { path: string; format: string | null };
  marks?: TemplateMark[];
};
export type ListFieldNode = {
  type: "listField";
  attrs: { list: string; itemPath: string; join: JoinStyle };
  marks?: TemplateMark[];
};
export type InlineNode = TextNode | HardBreakNode | FieldNode | ListFieldNode;

export type ParagraphNode = {
  type: "paragraph";
  attrs?: { textAlign?: TextAlign | null };
  content?: InlineNode[];
};
export type HeadingNode = {
  type: "heading";
  attrs: { level: 1 | 2 | 3; textAlign?: TextAlign | null };
  content?: InlineNode[];
};
export type ListItemNode = { type: "listItem"; content: BlockNode[] };
export type BulletListNode = { type: "bulletList"; content: ListItemNode[] };
export type OrderedListNode = { type: "orderedList"; content: ListItemNode[] };
export type TableCellNode = {
  type: "tableCell" | "tableHeader";
  attrs?: { colspan?: 1; rowspan?: 1; colwidth?: number[] | null };
  content: BlockNode[];
};
export type TableRowNode = { type: "tableRow"; content: TableCellNode[] };
export type TableNode = { type: "table"; content: TableRowNode[] };
export type PageBreakNode = { type: "pageBreak" };
export type BlockRefNode = { type: "block"; attrs: { blockId: string } };
export type ShowIfNode = {
  type: "showIf";
  attrs: { path: string; op: ShowIfOp; values: string[] };
  content: BlockNode[];
};
export type RepeatEmptyNode = { type: "repeatEmpty"; content?: BlockNode[] };
export type RepeatNode = {
  type: "repeat";
  attrs: { list: string };
  content: (BlockNode | RepeatEmptyNode)[];
};

export type BlockNode =
  | ParagraphNode
  | HeadingNode
  | BulletListNode
  | OrderedListNode
  | TableNode
  | PageBreakNode
  | BlockRefNode
  | ShowIfNode
  | RepeatNode;

export type TemplateDoc = { type: "doc"; content?: BlockNode[] };

export type TemplateNode =
  | TemplateDoc
  | BlockNode
  | InlineNode
  | ListItemNode
  | TableRowNode
  | TableCellNode
  | RepeatEmptyNode;

export type ValidationResult = { ok: true; doc: TemplateDoc } | { ok: false; error: string };

class Invalid extends Error {}
const fail = (msg: string): never => {
  throw new Invalid(msg);
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

type Ctx = { kind: TemplateKind; isBlock: boolean };

const ALIGNS = ["left", "center", "right", "justify"];
const MARKS: MarkType[] = ["bold", "italic", "underline"];

function str(v: unknown, what: string): string {
  if (typeof v !== "string" || v.length === 0) {
    return fail(`${what} must be a non-empty string.`);
  }
  return v;
}

function attrsOf(n: Obj): Obj {
  if (n.attrs === undefined || n.attrs === null) return {};
  if (!isObj(n.attrs)) return fail(`${String(n.type)} attrs must be an object.`);
  return n.attrs;
}

function align(a: Obj): TextAlign | null | undefined {
  const v = a.textAlign;
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === "string" && ALIGNS.includes(v)) return v as TextAlign;
  return fail("Invalid text alignment.");
}

function marks(n: Obj, ctx: Ctx): TemplateMark[] | undefined {
  if (n.marks === undefined) return undefined;
  if (!Array.isArray(n.marks)) return fail("marks must be an array.");
  if (n.marks.length === 0) return undefined;
  if (ctx.kind === "sms") return fail("SMS templates cannot use formatting.");
  return n.marks.map((m) => {
    if (!isObj(m) || !MARKS.includes(m.type as MarkType)) {
      return fail(`Unknown mark "${isObj(m) ? String(m.type) : String(m)}".`);
    }
    return { type: m.type as MarkType };
  });
}

function children(n: Obj): unknown[] {
  if (n.content === undefined) return [];
  if (!Array.isArray(n.content)) {
    return fail(`${String(n.type)} content must be an array.`);
  }
  return n.content;
}

function noContent(n: Obj) {
  if (n.content !== undefined && !(Array.isArray(n.content) && n.content.length === 0)) {
    fail(`${String(n.type)} cannot have content.`);
  }
}

function nodeType(raw: unknown, depth: number): { n: Obj; t: string } {
  if (!isObj(raw)) return fail("Template content is malformed.");
  if (typeof raw.type !== "string") return fail("A node is missing its type.");
  if (depth > MAX_DEPTH) return fail("Template is nested too deeply.");
  return { n: raw, t: raw.type };
}

function inline(raw: unknown, depth: number, ctx: Ctx): InlineNode {
  const { n, t } = nodeType(raw, depth);
  switch (t) {
    case "text": {
      if (typeof n.text !== "string") return fail("Text node needs text.");
      const m = marks(n, ctx);
      return m ? { type: "text", text: n.text, marks: m } : { type: "text", text: n.text };
    }
    case "hardBreak":
      noContent(n);
      return { type: "hardBreak" };
    case "field": {
      noContent(n);
      const a = attrsOf(n);
      const path = str(a.path, "Field path");
      const f = a.format;
      if (f !== undefined && f !== null && typeof f !== "string") {
        return fail("Field format must be a string.");
      }
      const m = marks(n, ctx);
      const out: FieldNode = { type: "field", attrs: { path, format: f ?? null } };
      if (m) out.marks = m;
      return out;
    }
    case "listField": {
      if (ctx.kind === "sms") return fail("SMS templates cannot use list fields.");
      noContent(n);
      const a = attrsOf(n);
      if (!JOIN_STYLES.includes(a.join as JoinStyle)) {
        return fail("Invalid list field join style.");
      }
      const m = marks(n, ctx);
      const out: ListFieldNode = {
        type: "listField",
        attrs: {
          list: str(a.list, "List name"),
          itemPath: str(a.itemPath, "List item path"),
          join: a.join as JoinStyle,
        },
      };
      if (m) out.marks = m;
      return out;
    }
    default:
      return fail(`Node type "${t}" is not allowed here.`);
  }
}

function inlineContent(n: Obj, depth: number, ctx: Ctx): InlineNode[] {
  return children(n).map((c) => inline(c, depth + 1, ctx));
}

const SMS_BLOCKS = ["paragraph"];

function blocks(
  list: unknown[],
  depth: number,
  ctx: Ctx,
  opts: { min?: number } = {},
): BlockNode[] {
  if (list.length < (opts.min ?? 0)) fail("A container cannot be empty.");
  return list.map((c) => block(c, depth, ctx));
}

function block(raw: unknown, depth: number, ctx: Ctx): BlockNode {
  const { n, t } = nodeType(raw, depth);
  const known = [
    "paragraph",
    "heading",
    "bulletList",
    "orderedList",
    "table",
    "pageBreak",
    "block",
    "showIf",
    "repeat",
  ];
  if (!known.includes(t)) {
    return fail(`Node type "${t}" is not allowed here.`);
  }
  if (ctx.kind === "sms" && !SMS_BLOCKS.includes(t)) {
    return fail(`SMS templates cannot contain "${t}".`);
  }
  switch (t) {
    case "paragraph": {
      const al = align(attrsOf(n));
      const content = inlineContent(n, depth, ctx);
      const out: ParagraphNode = { type: "paragraph" };
      if (al !== undefined) out.attrs = { textAlign: al };
      if (content.length) out.content = content;
      return out;
    }
    case "heading": {
      const a = attrsOf(n);
      if (a.level !== 1 && a.level !== 2 && a.level !== 3) {
        return fail("Heading level must be 1, 2 or 3.");
      }
      const al = align(a);
      const content = inlineContent(n, depth, ctx);
      const out: HeadingNode = {
        type: "heading",
        attrs: al === undefined ? { level: a.level } : { level: a.level, textAlign: al },
      };
      if (content.length) out.content = content;
      return out;
    }
    case "bulletList":
    case "orderedList": {
      const items = children(n);
      if (items.length === 0) return fail("A list needs at least one item.");
      return {
        type: t,
        content: items.map((i) => listItem(i, depth + 1, ctx)),
      } as BulletListNode | OrderedListNode;
    }
    case "table": {
      const rows = children(n);
      if (rows.length === 0) return fail("A table needs at least one row.");
      return { type: "table", content: rows.map((r) => tableRow(r, depth + 1, ctx)) };
    }
    case "pageBreak":
      if (ctx.kind === "email") return fail("Email templates cannot contain page breaks.");
      noContent(n);
      return { type: "pageBreak" };
    case "block": {
      if (ctx.isBlock) return fail("A block cannot contain other blocks.");
      noContent(n);
      return { type: "block", attrs: { blockId: str(attrsOf(n).blockId, "Block id") } };
    }
    case "showIf": {
      const a = attrsOf(n);
      if (!SHOW_IF_OPS.includes(a.op as ShowIfOp)) return fail("Invalid show-if condition.");
      const values = a.values === undefined ? [] : a.values;
      if (!Array.isArray(values) || !values.every((v) => typeof v === "string")) {
        return fail("Show-if values must be strings.");
      }
      return {
        type: "showIf",
        attrs: {
          path: str(a.path, "Show-if path"),
          op: a.op as ShowIfOp,
          values: values as string[],
        },
        content: blocks(children(n), depth + 1, ctx, { min: 1 }),
      };
    }
    default: {
      // repeat
      const a = attrsOf(n);
      const kids = children(n);
      const last = kids[kids.length - 1];
      const hasEmpty = isObj(last) && last.type === "repeatEmpty";
      const body = hasEmpty ? kids.slice(0, -1) : kids;
      const content: (BlockNode | RepeatEmptyNode)[] = blocks(body, depth + 1, ctx, { min: 1 });
      if (hasEmpty) {
        const { n: e } = nodeType(last, depth + 1);
        const inner = blocks(children(e), depth + 2, ctx);
        content.push(
          inner.length ? { type: "repeatEmpty", content: inner } : { type: "repeatEmpty" },
        );
      }
      return { type: "repeat", attrs: { list: str(a.list, "Repeat list") }, content };
    }
  }
}

function listItem(raw: unknown, depth: number, ctx: Ctx): ListItemNode {
  const { n, t } = nodeType(raw, depth);
  if (t !== "listItem") return fail(`Node type "${t}" is not allowed here.`);
  return { type: "listItem", content: blocks(children(n), depth + 1, ctx, { min: 1 }) };
}

function tableRow(raw: unknown, depth: number, ctx: Ctx): TableRowNode {
  const { n, t } = nodeType(raw, depth);
  if (t !== "tableRow") return fail(`Node type "${t}" is not allowed here.`);
  const cells = children(n);
  if (cells.length === 0) return fail("A table row needs at least one cell.");
  return { type: "tableRow", content: cells.map((c) => tableCell(c, depth + 1, ctx)) };
}

function tableCell(raw: unknown, depth: number, ctx: Ctx): TableCellNode {
  const { n, t } = nodeType(raw, depth);
  if (t !== "tableCell" && t !== "tableHeader") {
    return fail(`Node type "${t}" is not allowed here.`);
  }
  const a = attrsOf(n);
  const attrs: NonNullable<TableCellNode["attrs"]> = {};
  for (const k of ["colspan", "rowspan"] as const) {
    if (a[k] === undefined || a[k] === null) continue;
    if (a[k] !== 1) return fail("Merged table cells are not supported.");
    attrs[k] = 1;
  }
  if (a.colwidth !== undefined && a.colwidth !== null) {
    if (
      !Array.isArray(a.colwidth) ||
      !a.colwidth.every((w) => typeof w === "number" && isFinite(w))
    ) {
      return fail("Invalid table column width.");
    }
    attrs.colwidth = a.colwidth as number[];
  } else if (a.colwidth === null) {
    attrs.colwidth = null;
  }
  const out: TableCellNode = {
    type: t,
    content: blocks(children(n), depth + 1, ctx, { min: 1 }),
  };
  if (Object.keys(attrs).length) out.attrs = attrs;
  return out;
}

function sizeOk(json: unknown): boolean {
  try {
    const s = JSON.stringify(json);
    return typeof s === "string" && s.length <= MAX_CONTENT_BYTES;
  } catch {
    return false;
  }
}

function run(json: unknown, ctx: Ctx, body: (n: Obj) => TemplateDoc): ValidationResult {
  try {
    if (!sizeOk(json)) {
      // Unserializable input is malformed; oversized input is too large.
      let serializable = true;
      try {
        serializable = typeof JSON.stringify(json) === "string";
      } catch {
        serializable = false;
      }
      return {
        ok: false,
        error: serializable ? "Template is too large." : "Template content is malformed.",
      };
    }
    if (!isObj(json) || json.type !== "doc") return fail("Template content must be a document.");
    return { ok: true, doc: body(json) };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message };
    return { ok: false, error: "Template content is malformed." };
  }
}

export function validateTemplateContent(
  kind: TemplateKind,
  json: unknown,
  opts: { isBlock?: boolean } = {},
): ValidationResult {
  const ctx: Ctx = { kind, isBlock: opts.isBlock === true };
  return run(json, ctx, (n) => {
    const content = blocks(children(n), 1, ctx);
    return content.length ? { type: "doc", content } : { type: "doc" };
  });
}

/** An email subject: a doc with exactly one paragraph of text/field only. */
export function validateSubject(json: unknown): ValidationResult {
  const ctx: Ctx = { kind: "sms", isBlock: true }; // no marks, no rich nodes
  return run(json, ctx, (n) => {
    const kids = children(n);
    if (kids.length !== 1) return fail("A subject must be a single line.");
    const p = block(kids[0], 1, ctx);
    if (p.type !== "paragraph") return fail("A subject must be a single line.");
    if (p.content?.some((c) => c.type !== "text" && c.type !== "field")) {
      return fail("A subject can only contain text and fields.");
    }
    return { type: "doc", content: [p] };
  });
}
