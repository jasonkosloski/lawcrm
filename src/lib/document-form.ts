/**
 * Document upload form constants — shared (client-safe) between the
 * upload composer, the streaming upload route and the blob token
 * route. Size caps live in `src/app/api/documents/upload/upload-config.ts`.
 */

/** Categories the upload composer lets the user choose from (and the
 *  upload routes accept). Mirrors the rendered grouping on the
 *  documents tab; "other" is the safe default for the composer, while
 *  the multi-file uploader defaults to "discovery". */
export const DOCUMENT_CATEGORIES = [
  "filing",
  "pleading",
  "discovery",
  "expert_report",
  "correspondence",
  "contract",
  "intake",
  "evidence",
  "vendor",
  "archive",
  "other",
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_CATEGORY_LABEL: Record<DocumentCategory, string> = {
  filing: "Filing",
  pleading: "Pleading",
  discovery: "Discovery",
  expert_report: "Expert report",
  correspondence: "Correspondence",
  contract: "Contract",
  intake: "Intake",
  evidence: "Evidence",
  vendor: "Vendor",
  archive: "Archive",
  other: "Other",
};
