/**
 * Document upload form state — shared between the action and the
 * client form. Lives in a non-"use server" file so we can export
 * the const + type alongside the action.
 */

export type DocumentFormState = {
  status: "idle" | "ok" | "error";
  /** Generic error string for the UI when validation or storage
   *  fails. Per-field errors are rare here; the form is mostly
   *  "did the upload succeed?". */
  error?: string;
};

export const documentInitialState: DocumentFormState = { status: "idle" };

/** Categories the upload form lets the user choose from. Mirrors the
 *  rendered grouping on the documents tab; "other" is the safe
 *  default. */
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
