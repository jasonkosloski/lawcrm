/**
 * Matter Detail — Documents tab. Auth + matter wall, then the shared
 * browser (see src/components/documents/documents-browser.tsx).
 */

import { DocumentsBrowser } from "@/components/documents/documents-browser";
import { requireUser } from "@/lib/current-user";
import { assertMatterAccess } from "@/lib/matter-access";

export default async function MatterDocumentsPage({
  params,
  searchParams,
}: PageProps<"/matters/[id]/documents">) {
  await requireUser();
  const { id } = await params;
  await assertMatterAccess(id);
  const sp = await searchParams;
  return (
    <DocumentsBrowser
      scope={{ kind: "matter", matterId: id }}
      folderParam={typeof sp.folder === "string" ? sp.folder : null}
    />
  );
}
