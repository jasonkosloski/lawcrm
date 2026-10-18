import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { assertMatterAccess } from "@/lib/matter-access";
import { scopeBasePath, scopePaths, type RecordScope } from "@/lib/record-scope";

/**
 * Access guard for a record scope (documents / folders that belong to
 * a matter OR an intake lead). Matter scope = `assertMatterAccess`;
 * lead scope 404s when the lead doesn't exist (intake is not
 * matter-ACL'd). Never wrap in try/catch. Returns the user id.
 */
export async function assertScopeAccess(scope: RecordScope): Promise<string> {
  if (scope.kind === "matter") return assertMatterAccess(scope.matterId);
  const userId = await getCurrentUserId();
  const lead = await prisma.lead.findUnique({
    where: { id: scope.leadId },
    select: { id: true },
  });
  if (!lead) notFound();
  return userId;
}

/** Error string when the scope is read-only (a converted lead — its
 *  records moved to the matter), else null. Matter scopes are always
 *  writable here. */
export async function assertScopeWritable(
  scope: RecordScope
): Promise<string | null> {
  if (scope.kind === "matter") return null;
  const lead = await prisma.lead.findUnique({
    where: { id: scope.leadId },
    select: { stage: true },
  });
  if (lead?.stage === "converted") {
    return "Lead is already converted — its documents moved to the matter. Work with them there.";
  }
  return null;
}

/** Revalidate the scope's documents tab (layout — it nests the
 *  viewer routes) and record overview, plus a document's viewer page. */
export function revalidateDocumentScope(
  scope: RecordScope,
  documentId?: string
): void {
  const [tab, base] = scopePaths(scope, "documents");
  revalidatePath(tab, "layout");
  revalidatePath(base);
  if (documentId) {
    revalidatePath(`${scopeBasePath(scope)}/documents/${documentId}`);
  }
}
