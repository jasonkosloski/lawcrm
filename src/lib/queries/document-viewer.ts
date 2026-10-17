/**
 * Data loader for the full-page document viewer
 * (`/matters/[id]/documents/[documentId]`).
 *
 * One shaped fetch per page render:
 *  - the document itself, scoped to the matter in the URL — a
 *    documentId belonging to another matter returns `null` and the
 *    page 404s (no cross-matter probing via URL editing);
 *  - uploader display fields (Document.uploadedBy is a bare user id,
 *    not a relation — resolved here);
 *  - folder name for the breadcrumb + the folderId the breadcrumb
 *    link must preserve (`?folder=...` on the Documents tab);
 *  - prev/next document ids within the SAME folder, ordered by name
 *    (id tiebreak) — the reviewer's "walk the production folder"
 *    navigation.
 */

import { prisma } from "@/lib/prisma";

export type ViewerDocument = {
  id: string;
  matterId: string;
  name: string;
  category: string;
  source: string | null;
  status: string;
  contentType: string | null;
  fileSize: number | null;
  /** Storage key (Document.fileUrl). Null = seeded row, no bytes. */
  fileUrl: string | null;
  folderId: string | null;
  folderName: string | null;
  uploadedByName: string | null;
  uploadedByInitials: string | null;
  createdAt: Date;
  /** Neighbor ids in the same folder, ordered by name (asc, id
   *  tiebreak). Null at the ends of the folder. */
  prevId: string | null;
  nextId: string | null;
};

export async function getDocumentForViewer(
  matterId: string,
  documentId: string
): Promise<ViewerDocument | null> {
  const doc = await prisma.document.findFirst({
    // matterId in the where clause is the matter-mismatch guard —
    // a valid documentId under the wrong matter URL is a miss.
    where: { id: documentId, matterId },
    select: {
      id: true,
      matterId: true,
      name: true,
      category: true,
      source: true,
      status: true,
      contentType: true,
      fileSize: true,
      fileUrl: true,
      folderId: true,
      folder: { select: { name: true } },
      uploadedBy: true,
      createdAt: true,
    },
  });
  if (!doc) return null;

  // Same-folder walk order (name asc, id tiebreak) resolved as a
  // keyset step in each direction — two LIMIT 1 queries instead of
  // pulling every sibling id (a discovery production dumped in one
  // folder can run to thousands of files, and this runs on every
  // viewer render and flag-mutation revalidation). Both the
  // comparison and the ORDER BY run in Postgres under the same
  // collation, so they agree. `folderId: null` matches the matter
  // root (Prisma turns the null into IS NULL).
  const folderScope = { matterId, folderId: doc.folderId };
  const [uploader, prev, next] = await Promise.all([
    doc.uploadedBy
      ? prisma.user.findUnique({
          where: { id: doc.uploadedBy },
          select: { name: true, initials: true },
        })
      : Promise.resolve(null),
    prisma.document.findFirst({
      where: {
        ...folderScope,
        OR: [
          { name: { lt: doc.name } },
          { name: doc.name, id: { lt: doc.id } },
        ],
      },
      orderBy: [{ name: "desc" }, { id: "desc" }],
      select: { id: true },
    }),
    prisma.document.findFirst({
      where: {
        ...folderScope,
        OR: [
          { name: { gt: doc.name } },
          { name: doc.name, id: { gt: doc.id } },
        ],
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true },
    }),
  ]);

  const prevId = prev?.id ?? null;
  const nextId = next?.id ?? null;

  return {
    id: doc.id,
    matterId: doc.matterId,
    name: doc.name,
    category: doc.category,
    source: doc.source,
    status: doc.status,
    contentType: doc.contentType,
    fileSize: doc.fileSize,
    fileUrl: doc.fileUrl,
    folderId: doc.folderId,
    folderName: doc.folder?.name ?? null,
    uploadedByName: uploader?.name ?? null,
    uploadedByInitials: uploader?.initials ?? null,
    createdAt: doc.createdAt,
    prevId,
    nextId,
  };
}
