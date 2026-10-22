/**
 * Display helpers shared by the Documents tab and the document
 * viewer. Client-safe (no server imports) — one source for the
 * category label, status chip and file-size formatting so the two
 * surfaces can't drift when a category or status is added.
 */

import { DOCUMENT_CATEGORY_LABEL, type DocumentCategory } from "@/lib/document-form";

/** Category label for a stored key; an unknown key (a category added
 *  to the column but not yet to the form list) shows as-is rather
 *  than crashing or going blank. */
export function documentCategoryLabel(category: string): string {
  return DOCUMENT_CATEGORY_LABEL[category as DocumentCategory] ?? category;
}

export type DocumentStatusMeta = { label: string; className: string };

const STATUS_META: Record<string, DocumentStatusMeta> = {
  active: { label: "Active", className: "bg-paper-2 text-ink-3 border-line" },
  filed: { label: "Filed", className: "bg-ok-soft text-ok border-line" },
  received: {
    label: "Received",
    className: "bg-brand-soft text-brand-700 border-brand-200",
  },
  review: {
    label: "Under review",
    className: "bg-warn-soft text-warn border-warn-border",
  },
  archived: {
    label: "Archived",
    className: "bg-paper-2 text-ink-4 border-line",
  },
};

/** Status chip metadata; unknown statuses fall back to "active". */
export function documentStatusMeta(status: string): DocumentStatusMeta {
  return STATUS_META[status] ?? STATUS_META.active;
}

/** Human file size; "—" for unknown/zero. */
export function formatFileSize(bytes: number | null): string {
  if (bytes === null || bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
