/**
 * Folder naming for records requests. Pure, client-safe.
 */

/** Top-level folder the records-requests folder lives under. */
export const RECORDS_INVESTIGATION_FOLDER_NAME = "Investigation";

/** Folder holding one subfolder per request, under Investigation. */
export const RECORDS_ROOT_FOLDER_NAME = "Records Requests";

/** Root folder name used before 2026-10-18; migrated on next use. */
export const LEGACY_RECORDS_ROOT_FOLDER_NAME = "Records";

const MAX_LENGTH = 120;

function cleanPart(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/[/\\]/g, "-");
}

/** "{custodian} — {type}", sanitized and capped at 120 characters. */
export function recordsFolderName(custodianName: string, typeName: string): string {
  return `${cleanPart(custodianName)} — ${cleanPart(typeName)}`.slice(0, MAX_LENGTH).trimEnd();
}
