/**
 * One folder's entries for the Documents tab (ADR-043): the documents
 * that live in the folder (top level only), each email's extracted
 * attachments nested under it, and — for each attachment — where copies
 * of it live ("Copy to…" makes independent documents that share the
 * stored file), so deleting the email can say which are saved elsewhere.
 */

import { prisma } from "@/lib/prisma";
import { scopeWhere, type RecordScope } from "@/lib/record-scope";
import { shapeDocumentRows, type DocumentRow } from "@/lib/queries/matter-detail";
import { emailKindOf } from "@/lib/email-attachment-extract";

export type ListingRow = DocumentRow & {
  isEmail: boolean;
  /** Email whose attachments haven't been extracted yet. */
  attachmentsPending: boolean;
};

export type ListingAttachment = ListingRow & {
  /** Folders holding a copy of this attachment (empty = not saved
   *  anywhere else). */
  copiedTo: string[];
};

export type FolderListing = {
  documents: (ListingRow & { attachments: ListingAttachment[] })[];
};

const ROOT_NAME = "All documents";

export async function getFolderListing(scope: RecordScope, folderId: string | null): Promise<FolderListing> {
  const own = await prisma.document.findMany({
    where: { ...scopeWhere(scope), folderId, parentDocumentId: null },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  const attachments = own.length
    ? await prisma.document.findMany({
        where: { parentDocumentId: { in: own.map((d) => d.id) } },
        orderBy: [{ attachmentIndex: "asc" }, { name: "asc" }],
      })
    : [];

  // Copies of each attachment: other documents sharing its stored file,
  // outside the email it belongs to.
  const keys = attachments.map((a) => a.fileUrl).filter((k): k is string => !!k);
  const [copies, folders] = await Promise.all([
    keys.length
      ? prisma.document.findMany({
          where: { ...scopeWhere(scope), fileUrl: { in: keys } },
          select: { id: true, fileUrl: true, folderId: true, parentDocumentId: true },
        })
      : Promise.resolve([]),
    prisma.documentFolder.findMany({ where: scopeWhere(scope), select: { id: true, name: true } }),
  ]);
  const folderName = (id: string | null) =>
    id === null ? ROOT_NAME : (folders.find((f) => f.id === id)?.name ?? "a folder");
  const copiedTo = (a: (typeof attachments)[number]) => [
    ...new Set(
      copies
        .filter(
          (c) =>
            c.fileUrl === a.fileUrl &&
            c.id !== a.id &&
            c.id !== a.parentDocumentId &&
            c.parentDocumentId !== a.parentDocumentId
        )
        .map((c) => folderName(c.folderId))
    ),
  ];

  const shaped = new Map((await shapeDocumentRows([...own, ...attachments])).map((r) => [r.id, r]));
  const row = (d: (typeof own)[number]): ListingRow => {
    const isEmail = emailKindOf(d.contentType, d.name) !== null;
    return { ...shaped.get(d.id)!, isEmail, attachmentsPending: isEmail && d.attachmentsExtractedAt === null };
  };

  return {
    documents: own.map((d) => ({
      ...row(d),
      attachments: attachments
        .filter((a) => a.parentDocumentId === d.id)
        .map((a) => ({ ...row(a), copiedTo: copiedTo(a) })),
    })),
  };
}
