/**
 * Lead Detail — document viewer.
 *
 * The shared viewer body scoped to the lead; a document that is not on
 * this lead 404s. Leads have no matter wall (no assertMatterAccess).
 */

import { DocumentViewerBody } from "@/components/documents/document-viewer-body";
import { requireUser } from "@/lib/current-user";

export default async function LeadDocumentViewerPage({
  params,
  searchParams,
}: PageProps<"/intake/[id]/documents/[documentId]">) {
  // Pages guard themselves: layouts don't re-run on soft navigation (ADR-028).
  await requireUser();
  const { id, documentId } = await params;
  return (
    <DocumentViewerBody
      scope={{ kind: "lead", leadId: id }}
      documentId={documentId}
      searchParams={await searchParams}
    />
  );
}
