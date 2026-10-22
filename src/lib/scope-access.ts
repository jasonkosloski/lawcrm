import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { assertMatterAccess } from "@/lib/matter-access";
import { assertLeadAccess } from "@/lib/lead-access";
import {
  scopeBasePath,
  scopePaths,
  scopeRequestPagePattern,
  type RecordScope,
} from "@/lib/record-scope";

/**
 * Access guard for a record scope (documents / folders that belong to
 * a matter OR an intake lead). Matter scope = `assertMatterAccess`;
 * lead scope = `assertLeadAccess` (404 when missing or restricted
 * and the user isn't on its team, ADR-049). Never wrap in try/catch.
 * Returns the user id.
 */
export async function assertScopeAccess(scope: RecordScope): Promise<string> {
  if (scope.kind === "matter") return assertMatterAccess(scope.matterId);
  return assertLeadAccess(scope.leadId);
}

/** Error string when the scope is read-only (a converted lead — its
 *  records moved to the matter), else null. Matter scopes are always
 *  writable here. */
export async function assertScopeWritable(scope: RecordScope): Promise<string | null> {
  if (scope.kind === "matter") return null;
  const lead = await prisma.lead.findUnique({
    where: { id: scope.leadId },
    select: { stage: true },
  });
  if (lead?.stage === "converted") {
    return "This lead is already converted — add this on the matter instead.";
  }
  return null;
}

/** Revalidate the scope's documents tab (layout — it nests the
 *  viewer routes) and record overview, plus a document's viewer page. */
export function revalidateDocumentScope(scope: RecordScope, documentId?: string): void {
  const [tab, base] = scopePaths(scope, "documents");
  revalidatePath(tab, "layout");
  revalidatePath(base);
  // Records-request pages list their linked / generated documents.
  revalidatePath(scopeRequestPagePattern(scope), "page");
  if (documentId) {
    revalidatePath(`${scopeBasePath(scope)}/documents/${documentId}`);
  }
}
