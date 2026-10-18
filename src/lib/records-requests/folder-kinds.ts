/**
 * Kinds of system-generated document folders. A non-null
 * `DocumentFolder.systemKind` means the folder is managed by a records
 * request and protected (no rename / move / delete). Pure, client-safe.
 */

import { scopeBasePath, type RecordScope } from "@/lib/record-scope";
import type { RecordsDocRole } from "@/lib/records-requests/roles";

export const FOLDER_SYSTEM_KINDS = [
  "records_root",
  "records_request",
  "records_request_docs",
  "records_responsive_docs",
] as const;
export type FolderSystemKind = (typeof FOLDER_SYSTEM_KINDS)[number];

export function isProtectedFolder(f: { systemKind: string | null }): boolean {
  return f.systemKind !== null;
}

/** The records page a generated folder links back to, or null for an
 *  ordinary folder. */
export function folderSourceLink(
  f: { systemKind: string | null; recordsRequestId: string | null },
  scope: RecordScope
): { href: string; label: string } | null {
  if (f.systemKind === "records_root") {
    return { href: `${scopeBasePath(scope)}/records`, label: "Records requests" };
  }
  if (f.systemKind !== null && f.recordsRequestId) {
    return {
      href: `${scopeBasePath(scope)}/records/${f.recordsRequestId}`,
      label: "Records request",
    };
  }
  return null;
}

export function kindForRole(role: RecordsDocRole): FolderSystemKind {
  return role === "request_letter"
    ? "records_request_docs"
    : "records_responsive_docs";
}
