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

  const [uploader, siblings] = await Promise.all([
    doc.uploadedBy
      ? prisma.user.findUnique({
          where: { id: doc.uploadedBy },
          select: { name: true, initials: true },
        })
      : Promise.resolve(null),
    // Same-folder walk order. Folder sizes are human-curated (a
    // production subfolder, not the whole matter), so pulling the
    // id+name list to find neighbors is cheap and keeps the
    // ordering logic in exactly one place.
    prisma.document.findMany({
      where: { matterId, folderId: doc.folderId },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true },
    }),
  ]);

  const idx = siblings.findIndex((s) => s.id === doc.id);
  const prevId = idx > 0 ? siblings[idx - 1].id : null;
  const nextId =
    idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1].id : null;

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
