/**
 * Matter Documents — full-page document viewer route. Auth + matter
 * wall, then the shared viewer body (see
 * src/components/documents/document-viewer-body.tsx).
 */

import { DocumentViewerBody } from "@/components/documents/document-viewer-body";
import { requireUser } from "@/lib/current-user";
import { assertMatterAccess } from "@/lib/matter-access";

export default async function DocumentViewerPage({
  params,
  searchParams,
}: PageProps<"/matters/[id]/documents/[documentId]">) {
  await requireUser();
  const { id, documentId } = await params;
  await assertMatterAccess(id);
  return (
    <DocumentViewerBody
      scope={{ kind: "matter", matterId: id }}
      documentId={documentId}
      searchParams={await searchParams}
    />
  );
}
