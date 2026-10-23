/**
 * The editor page's input shapes and the pure helpers that turn them
 * into initial editor state (legacy bodies are converted on open).
 */

import {
  FIELDS,
  LISTS,
  SAMPLE_TEMPLATE_DATA,
  fieldsForScope,
  type CatalogField,
  type CatalogList,
  type TemplateData,
} from "@/lib/templates/catalog";
import { convertHeadings } from "@/lib/templates/headings";
import { convertLegacyBody } from "@/lib/templates/legacy";
import type { SerializedCourtContext } from "@/lib/templates/court-blocks";
import type { ParagraphStyle } from "@/lib/templates/paragraph-styles";
import type { FirmPageStyle } from "@/lib/templates/page-render";
import type { BlockSource } from "@/lib/templates/render";
import type { AppliesTo, TemplateDoc, TemplateKind } from "@/lib/templates/schema";
import type { BlockMeta, TemplateMeta } from "./metadata-form";
import type { Usage } from "./page-chrome";

export type EditorTemplate = {
  id: string | null;
  name: string;
  category: string;
  description: string | null;
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
  content: TemplateDoc | null;
  updatedAt: string | null;
};

export type EditorProps = {
  canSave: boolean;
  /** The firm's paragraph styles (blocks get them here; templates also via pageStyle). */
  paragraphStyles?: ParagraphStyle[];
} & (
  | {
      template: EditorTemplate;
      blocks: BlockSource[];
      /** Firm document style: letters/filings preview as a styled page. */
      pageStyle?: FirmPageStyle;
      /** Active court formats, for the filing preview's "Preview as". */
      courtFormats?: SerializedCourtContext[];
      block?: undefined;
      usage?: undefined;
    }
  | {
      block: EditorBlock;
      usage: Usage[];
      template?: undefined;
      blocks?: undefined;
      pageStyle?: undefined;
      courtFormats?: undefined;
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
  kind: t.kind,
  appliesTo: t.appliesTo,
});
export const blockMeta = (b: EditorBlock): BlockMeta => ({
  name: b.name,
  key: b.key,
  description: b.description ?? "",
});

export function titleOf(p: EditorProps): string {
  if (p.block) return p.block.id ? p.block.name : "New block";
  return p.template.id ? p.template.name : "New template";
}

/** What the field picker and rule forms offer, and the preview data.
 *  Blocks are shared across scopes, so they see the whole catalog. */
export function catalogFor(
  isBlock: boolean,
  appliesTo: AppliesTo,
): { fields: CatalogField[]; lists: CatalogList[]; data: TemplateData } {
  const fits = (scopes: readonly string[]) =>
    isBlock || (appliesTo === "both" ? scopes.length === 2 : scopes.includes(appliesTo));
  return {
    fields: isBlock ? [...FIELDS] : fieldsForScope(appliesTo),
    lists: LISTS.filter((l) => fits(l.scopes)),
    data: { ...SAMPLE_TEMPLATE_DATA, scope: appliesTo === "lead" ? "lead" : "matter" },
  };
}
