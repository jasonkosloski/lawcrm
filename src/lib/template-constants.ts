/**
 * Document-template constants — client-safe.
 *
 * The category list the template library's select + grouping draw
 * from. `DocumentTemplate.category` is a free string in the schema
 * (new categories are data, not a migration) — this file is the v1
 * curated list the UI offers. Rows whose category isn't in the list
 * still render (label falls back to the raw string), so loosening
 * the action-layer validation later requires no read-side change.
 */

import type { AppliesTo, TemplateKind } from "@/lib/templates/schema";

export const TEMPLATE_CATEGORIES = [
  "demand_letter",
  "discovery",
  "retainer",
  "correspondence",
  "pleading",
  "general",
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const TEMPLATE_CATEGORY_LABEL: Record<TemplateCategory, string> = {
  demand_letter: "Demand letters",
  discovery: "Discovery",
  retainer: "Retainers",
  correspondence: "Correspondence",
  pleading: "Pleadings",
  general: "General",
};

export function isTemplateCategory(v: string): v is TemplateCategory {
  return (TEMPLATE_CATEGORIES as readonly string[]).includes(v);
}

/** Display label, tolerant of categories outside the curated list
 *  (schema is a free string — never crash on a row we didn't mint). */
export function templateCategoryLabel(category: string): string {
  return isTemplateCategory(category) ? TEMPLATE_CATEGORY_LABEL[category] : category;
}

/**
 * Where a generated document lands on the matter Documents tab.
 * Template categories are letter-shaped; Document categories are
 * filing-cabinet-shaped — this is the bridge. Unknown template
 * categories fall through to "other".
 */
const TEMPLATE_TO_DOCUMENT_CATEGORY: Record<TemplateCategory, string> = {
  demand_letter: "correspondence",
  discovery: "discovery",
  retainer: "contract",
  correspondence: "correspondence",
  pleading: "pleading",
  general: "other",
};

export function documentCategoryForTemplate(category: string): string {
  return isTemplateCategory(category) ? TEMPLATE_TO_DOCUMENT_CATEGORY[category] : "other";
}

// Field limits — enforced by the action-layer zod schema and used
// as input maxLength hints in the editor.
export const MAX_TEMPLATE_NAME = 120;
export const MAX_TEMPLATE_DESCRIPTION = 500;
export const MAX_DOCUMENT_TITLE = 200;

export const TEMPLATE_KIND_LABEL: Record<TemplateKind, string> = {
  letter: "Letter",
  email: "Email",
  sms: "Text message",
  filing: "Filing",
};

export const APPLIES_TO_LABEL: Record<AppliesTo, string> = {
  matter: "Matters",
  lead: "Leads",
  both: "Matters and leads",
};

/** Refusal copy when a template changed after the user previewed it. */
export const STALE_TEMPLATE = "This template changed — review the preview again.";

/** The compose editor keeps tables, underline, small caps and paragraph
 *  spacing and alignment, but not table borders/widths, cell vertical
 *  alignment, heading alignment or H1. */
export const EMAIL_FORMATTING_NOTE =
  "Table borders, widths and cell vertical alignment, heading alignment and top-level headings aren't kept in email.";
