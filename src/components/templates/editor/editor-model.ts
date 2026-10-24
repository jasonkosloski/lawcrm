/**
 * The editor page's input shapes and the pure helpers that turn them
 * into initial editor state (legacy bodies are converted on open).
 */

import {
  LISTS,
  SAMPLE_TEMPLATE_DATA,
  fieldsForScope,
  type CatalogField,
  type CatalogList,
  type TemplateData,
} from "@/lib/templates/catalog";
import {
  MAX_BLOCK_DEPTH,
  ancestors,
  depthAbove,
  height,
  scopeCovers,
} from "@/lib/templates/block-graph";
import { convertHeadings } from "@/lib/templates/headings";
import { convertLegacyBody } from "@/lib/templates/legacy";
import type { SerializedCourtContext } from "@/lib/templates/court-blocks";
import type { ParagraphStyle } from "@/lib/templates/paragraph-styles";
import type { FirmPageStyle } from "@/lib/templates/page-render";
import type { BlockSource } from "@/lib/templates/render";
import {
  isDocumentKind,
  type AppliesTo,
  type TemplateDoc,
  type TemplateKind,
} from "@/lib/templates/schema";
import type { BlockMeta, TemplateMeta } from "./metadata-form";
import type { Usage } from "./page-chrome";

export type EditorTemplate = {
  id: string | null;
  name: string;
  category: string;
  description: string | null;
  /** Letters and filings: default for the `document.title` field. */
  documentTitle: string | null;
  kind: TemplateKind;
  appliesTo: AppliesTo;
  /** Null for a legacy `{{token}}` template (converted on open). */
  content: TemplateDoc | null;
  body: string | null;
  subject: TemplateDoc | null;
  updatedAt: string | null;
};

export type EditorBlock = {
  id: string | null;
  key: string;
  name: string;
  description: string | null;
  /** Absent (a new block) means "both". */
  appliesTo?: AppliesTo;
  content: TemplateDoc | null;
  updatedAt: string | null;
};

export type EditorProps = {
  canSave: boolean;
  /** The firm's paragraph styles; defaults to the page style's. */
  paragraphStyles?: ParagraphStyle[];
  /** Firm document style: the preview is a styled page. */
  pageStyle?: FirmPageStyle;
  /** Active court formats, for the preview's "Preview as". */
  courtFormats?: SerializedCourtContext[];
  /** Every block (active and archived): rendering, Insert block, fit checks. */
  blocks: BlockSource[];
} & (
  | {
      template: EditorTemplate;
      block?: undefined;
      usage?: undefined;
    }
  | {
      block: EditorBlock;
      usage: Usage[];
      template?: undefined;
    }
);

const EMPTY_DOC: TemplateDoc = { type: "doc", content: [{ type: "paragraph" }] };
/** The doc a page opens with, and whether it came from a legacy body. */
export function initialDoc(p: EditorProps): { doc: TemplateDoc; legacy: boolean } {
  if (p.block) return { doc: convertHeadings(p.block.content ?? EMPTY_DOC), legacy: false };
  const t = p.template;
  if (t.content) return { doc: convertHeadings(t.content), legacy: false };
  if (t.id) return { doc: convertLegacyBody(t.body ?? ""), legacy: true };
  return { doc: EMPTY_DOC, legacy: false };
}

export const templateMeta = (t: EditorTemplate): TemplateMeta => ({
  name: t.name,
  category: t.category,
  description: t.description ?? "",
  documentTitle: t.documentTitle ?? "",
  kind: t.kind,
  appliesTo: t.appliesTo,
});
export const blockMeta = (b: EditorBlock): BlockMeta => ({
  name: b.name,
  key: b.key,
  description: b.description ?? "",
  appliesTo: b.appliesTo ?? "both",
});

export function titleOf(p: EditorProps): string {
  if (p.block) return p.block.id ? p.block.name : "New block";
  return p.template.id ? p.template.name : "New template";
}

/** What the field picker and rule forms offer, and the preview data.
 *  `document.title` is offered only where it can be filled: letters,
 *  filings, and blocks (no `kind`), which go inside them. */
export function catalogFor(
  appliesTo: AppliesTo,
  kind?: TemplateKind,
): {
  fields: CatalogField[];
  lists: CatalogList[];
  data: TemplateData;
} {
  const fits = (scopes: readonly string[]) =>
    appliesTo === "both" ? scopes.length === 2 : scopes.includes(appliesTo);
  return {
    fields: fieldsForScope(appliesTo).filter(
      (f) => f.path !== "document.title" || kind === undefined || isDocumentKind(kind),
    ),
    lists: LISTS.filter((l) => fits(l.scopes)),
    data: { ...SAMPLE_TEMPLATE_DATA, scope: appliesTo === "lead" ? "lead" : "matter" },
  };
}

/** What "Insert block" offers a template or block (`host.id` null for a
 *  template or a new block): active blocks whose scope covers the host's,
 *  leaving out the host, every block that contains it, and blocks that
 *  would nest more than MAX_BLOCK_DEPTH deep. The save re-checks all of it. */
export function insertableBlocks(
  all: BlockSource[],
  host: { id: string | null; appliesTo: AppliesTo; isBlock: boolean },
): BlockSource[] {
  const map = new Map(all.map((b) => [b.id, b]));
  const above = host.id ? ancestors(host.id, map) : new Set<string>();
  // Levels taken above a child: the host block's own level, at its deepest.
  const offset = host.isBlock ? (host.id ? depthAbove(host.id, map) : 0) + 1 : 0;
  return all.filter(
    (b) =>
      b.isActive &&
      b.id !== host.id &&
      !above.has(b.id) &&
      scopeCovers(b.appliesTo ?? "both", host.appliesTo) &&
      offset + height(b.id, map) <= MAX_BLOCK_DEPTH,
  );
}
