/**
 * Shared label helpers for the template editor's chips and rule headers.
 * Pure (no React) so the node views, the property dialogs and tests all
 * agree on the same copy.
 */

import { fieldByPath, listByPath, type CatalogField } from "@/lib/templates/catalog";
import type { JoinStyle } from "@/lib/templates/schema";

export const FORMAT_LABELS: Record<string, string> = {
  long: "Long date",
  short: "Short date",
  iso: "ISO date",
  full: "Full name",
  first: "First name",
  last: "Last name",
  as_is: "As written",
  upper: "UPPERCASE",
  block: "Block",
  one_line: "One line",
};

export const JOIN_LABELS: Record<JoinStyle, string> = {
  and: "and",
  oxford_and: "Oxford and",
  lines: "Lines",
};

/**
 * Resolve a field path to its catalog entry. Inside a repeat, `item.x`
 * resolves against that list's item fields (`repeatList`).
 */
export function resolveField(path: string, repeatList?: string | null): CatalogField | undefined {
  if (path.startsWith("item.")) {
    if (!repeatList) return undefined;
    const sub = path.slice("item.".length);
    return listByPath(repeatList)?.itemFields.find((f) => f.path === sub);
  }
  return fieldByPath(path);
}

/** Catalog label of a path, or the raw path when unknown. */
export function pathLabel(path: string, repeatList?: string | null): string {
  return resolveField(path, repeatList)?.label ?? path;
}
