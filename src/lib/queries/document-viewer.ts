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
  /** The email this file was extracted from (ADR-043), if any. */
  parent: { id: string; name: string } | null;
  /** Email only: its extracted attachments by position, so the
   *  attachment chips can open them; null = not extracted yet. */
  attachmentDocs: { id: string; attachmentIndex: number | null }[] | null;
  /** Neighbor ids in the same folder, ordered by name (asc, id
   *  tiebreak). Null at the ends of the folder. An attachment's
   *  neighbors are its email's other attachments. */
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
      parentDocumentId: true,
      attachmentsExtractedAt: true,
      parentDocument: { select: { id: true, name: true } },
      attachments: { select: { id: true, attachmentIndex: true }, orderBy: { attachmentIndex: "asc" } },
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
  const folderScope = { matterId, folderId: doc.folderId, parentDocumentId: doc.parentDocumentId };
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
    parent: doc.parentDocument,
    attachmentDocs: doc.attachmentsExtractedAt ? doc.attachments : null,
    prevId,
    nextId,
  };
}

/** One file in the viewer's left-hand file tree. */
export type FileTreeDocument = {
  id: string;
  name: string;
  folderId: string | null;
  contentType: string | null;
  /** Set on an email's extracted attachment: it shows under the email. */
  parentDocumentId: string | null;
  attachmentIndex: number | null;
};


/** Cap on files loaded into the viewer's tree in one go. A discovery
 *  production can hold many thousands of files; past this the tree
 *  still lists every folder, but only the current folder's files —
 *  other folders link to the Documents tab instead of showing a
 *  misleading partial list. */
export const FILE_TREE_MAX_DOCUMENTS = 3000;

/**
 * The matter's files for the viewer's file tree: lightweight columns
 * only (no sizes, uploaders or storage keys), ordered by name. When the
 * matter has more than FILE_TREE_MAX_DOCUMENTS, `complete` is false and
 * only the current folder's files are returned.
 */
export async function getViewerFileTree(
  matterId: string,
  currentFolderId: string | null
): Promise<{ documents: FileTreeDocument[]; complete: boolean }> {
  const select = {
    id: true,
    name: true,
    folderId: true,
    contentType: true,
    parentDocumentId: true,
    attachmentIndex: true,
  } as const;
  const orderBy = [{ name: "asc" as const }, { id: "asc" as const }];
  const all = await prisma.document.findMany({
    where: { matterId },
    select,
    orderBy,
    take: FILE_TREE_MAX_DOCUMENTS + 1,
  });
  if (all.length <= FILE_TREE_MAX_DOCUMENTS) return { documents: all, complete: true };
  // Too many to list: just the folder the reader is working through
  // (its files and their attachments).
  const current = await prisma.document.findMany({
    where: { matterId, folderId: currentFolderId },
    select,
    orderBy,
  });
  return { documents: current, complete: false };
}
