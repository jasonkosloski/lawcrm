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

/** Maximum bytes per uploaded file. 25 MB matches Gmail's attachment
 *  ceiling and covers >95% of real legal documents (filings, briefs,
 *  contracts). Larger evidence (video, depo recordings) goes through
 *  the future Evidence model with chunked uploads. */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/** Optional per-upload metadata the composer sends alongside the
 *  file on BOTH transports (streaming route form fields / blob
 *  clientPayload). Shared so the two paths validate identically.
 *  `name` is a display-name override ("" = keep the file's own);
 *  `category` is one of DOCUMENT_CATEGORIES. Returns null on an
 *  invalid category or over-long name. */
export function parseUploadMeta(input: {
  name?: unknown;
  category?: unknown;
}): { name: string; category: DocumentCategory } | null {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length > 200) return null;
  const category = input.category ?? "other";
  if (
    typeof category !== "string" ||
    !(DOCUMENT_CATEGORIES as readonly string[]).includes(category)
  ) {
    return null;
  }
  return { name, category: category as DocumentCategory };
}
