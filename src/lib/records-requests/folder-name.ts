/**
 * Folder naming for records requests. Pure, client-safe.
 */

export const RECORDS_ROOT_FOLDER_NAME = "Records";

const MAX_LENGTH = 120;

function cleanPart(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/[/\\]/g, "-");
}

/** "{custodian} — {type}", sanitized and capped at 120 characters. */
export function recordsFolderName(custodianName: string, typeName: string): string {
  return `${cleanPart(custodianName)} — ${cleanPart(typeName)}`
    .slice(0, MAX_LENGTH)
    .trimEnd();
}
