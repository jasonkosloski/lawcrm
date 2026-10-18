/**
 * One folder's entries for the Documents tab (ADR-043):
 *   - documents that live in the folder (top level only),
 *   - each email's extracted attachments, nested under it,
 *   - documents that live elsewhere but are ALSO filed here
 *     (DocumentLink), shown as links to the same document,
 * plus, for every document listed, the other folders it's filed in
 * (its links), so rows can say "also in …" and offer "remove from
 * this folder".
 */

import { prisma } from "@/lib/prisma";
import { shapeDocumentRows, type DocumentRow } from "@/lib/queries/matter-detail";
import { emailKindOf } from "@/lib/email-attachment-extract";

/** Another folder a document is filed in (one of its DocumentLinks). */
export type FiledIn = { linkId: string; folderId: string | null; folderName: string };

export type ListingRow = DocumentRow & {
  isEmail: boolean;
  /** Email whose attachments haven't been extracted yet. */
  attachmentsPending: boolean;
  alsoIn: FiledIn[];
};

export type FolderListing = {
  documents: (ListingRow & { attachments: ListingRow[] })[];
  /** Documents filed here via a link; `linkId` removes just this place. */
  linked: (ListingRow & { linkId: string; homeName: string })[];
};

const ROOT_NAME = "All documents";

export async function getFolderListing(matterId: string, folderId: string | null): Promise<FolderListing> {
  const [own, links] = await Promise.all([
    prisma.document.findMany({
      where: { matterId, folderId, parentDocumentId: null },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    prisma.documentLink.findMany({
      where: { matterId, folderId },
      select: { id: true, documentId: true },
    }),
  ]);
  const attachments = own.length
    ? await prisma.document.findMany({
        where: { parentDocumentId: { in: own.map((d) => d.id) } },
        orderBy: [{ attachmentIndex: "asc" }, { name: "asc" }],
      })
    : [];
  const linkedDocs = links.length
    ? await prisma.document.findMany({
        where: { id: { in: links.map((l) => l.documentId) }, matterId },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      })
    : [];

  const all = [...own, ...attachments, ...linkedDocs];
  const ids = [...new Set(all.map((d) => d.id))];
  // Every other place each listed document is filed, with names.
  const [allLinks, folders, parents] = await Promise.all([
    prisma.documentLink.findMany({
      where: { documentId: { in: ids } },
      select: { id: true, documentId: true, folderId: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.documentFolder.findMany({ where: { matterId }, select: { id: true, name: true } }),
    prisma.document.findMany({
      where: { id: { in: linkedDocs.map((d) => d.parentDocumentId).filter((v): v is string => !!v) } },
      select: { id: true, name: true },
    }),
  ]);
  const folderName = (id: string | null) =>
    id === null ? ROOT_NAME : (folders.find((f) => f.id === id)?.name ?? "a folder");
  const shaped = new Map((await shapeDocumentRows(all)).map((r) => [r.id, r]));
  const raw = new Map(all.map((d) => [d.id, d]));

  const row = (id: string): ListingRow => {
    const d = raw.get(id)!;
    return {
      ...shaped.get(id)!,
      isEmail: emailKindOf(d.contentType, d.name) !== null,
      attachmentsPending: emailKindOf(d.contentType, d.name) !== null && d.attachmentsExtractedAt === null,
      alsoIn: allLinks
        .filter((l) => l.documentId === id)
        .map((l) => ({ linkId: l.id, folderId: l.folderId, folderName: folderName(l.folderId) })),
    };
  };

  return {
    documents: own.map((d) => ({
      ...row(d.id),
      attachments: attachments.filter((a) => a.parentDocumentId === d.id).map((a) => row(a.id)),
    })),
    linked: links
      .filter((l) => raw.has(l.documentId))
      .sort((a, b) => raw.get(a.documentId)!.name.localeCompare(raw.get(b.documentId)!.name))
      .map((l) => {
        const d = raw.get(l.documentId)!;
        const parent = parents.find((p) => p.id === d.parentDocumentId);
        return {
          ...row(d.id),
          linkId: l.id,
          homeName: parent ? `${parent.name} (attachment)` : folderName(d.folderId),
        };
      }),
  };
}
