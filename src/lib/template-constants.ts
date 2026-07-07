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
  return isTemplateCategory(category)
    ? TEMPLATE_CATEGORY_LABEL[category]
    : category;
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
  return isTemplateCategory(category)
    ? TEMPLATE_TO_DOCUMENT_CATEGORY[category]
    : "other";
}

// Field limits — enforced by the action-layer zod schema and used
// as input maxLength hints in the editor.
export const MAX_TEMPLATE_NAME = 120;
export const MAX_TEMPLATE_DESCRIPTION = 500;
export const MAX_TEMPLATE_BODY = 50_000;

/** Shared useActionState shape for the create/edit template forms. */
export type TemplateFormState = {
  status: "idle" | "ok" | "error";
  error: string | null;
};

export const templateFormInitialState: TemplateFormState = {
  status: "idle",
  error: null,
};
