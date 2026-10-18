/**
 * Records-request document roles: the stored value, its UI label and the
 * fixed subfolder it files into. Pure, client-safe.
 */

export const RECORDS_DOC_ROLES = ["request_letter", "received_records"] as const;
export type RecordsDocRole = (typeof RECORDS_DOC_ROLES)[number];

export const RECORDS_REQUEST_DOCS_FOLDER = "Request documents";
export const RECORDS_RESPONSIVE_DOCS_FOLDER = "Responsive documents";

export const RECORDS_ROLE_INFO: Record<
  RecordsDocRole,
  { label: string; folderName: string }
> = {
  request_letter: { label: "Request documents", folderName: RECORDS_REQUEST_DOCS_FOLDER },
  received_records: {
    label: "Responsive documents",
    folderName: RECORDS_RESPONSIVE_DOCS_FOLDER,
  },
};

export function isRecordsDocRole(v: unknown): v is RecordsDocRole {
  return typeof v === "string" && (RECORDS_DOC_ROLES as readonly string[]).includes(v);
}
