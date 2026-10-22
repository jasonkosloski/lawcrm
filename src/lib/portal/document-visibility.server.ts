import "server-only";

import { prisma } from "@/lib/prisma";
import { portalMatterWhere } from "@/lib/portal-access";
import { isEffectivelyShared, sharedFolderIds } from "@/lib/portal/document-visibility";

export type PortalDocumentRow = {
  id: string;
  name: string;
  contentType: string | null;
  fileSize: number | null;
  createdAt: Date;
  folderName: string | null;
};

export type PortalUploadRow = {
  id: string;
  name: string;
  fileSize: number | null;
  createdAt: Date;
  requestTitle: string | null;
  uploaderEmail: string;
};

async function portalIsOn(): Promise<boolean> {
  const firm = await prisma.firm.findFirst({ select: { portalEnabled: true } });
  return !!firm?.portalEnabled;
}

/** True when the identity holds live access to the matter and the portal is on. */
async function hasLiveAccess(identityId: string, matterId: string): Promise<boolean> {
  if (!(await portalIsOn())) return false;
  const m = await prisma.matter.findFirst({
    where: { id: matterId, ...portalMatterWhere(identityId) },
    select: { id: true },
  });
  return !!m;
}

/**
 * Documents the client may see on a matter: effectively shared (direct share,
 * or inside a shared folder and not hidden), not archived. Folder inheritance
 * is computed at read time, so moving a file or unsharing a folder takes
 * effect immediately and a per-file "hidden" survives re-sharing.
 */
export async function listPortalSharedDocuments(
  identityId: string,
  matterId: string,
): Promise<PortalDocumentRow[]> {
  if (!(await hasLiveAccess(identityId, matterId))) return [];
  const [folders, docs] = await Promise.all([
    prisma.documentFolder.findMany({
      where: { matterId },
      select: { id: true, name: true, parentId: true, clientShared: true },
    }),
    prisma.document.findMany({
      where: { matterId, status: { not: "archived" } },
      select: {
        id: true,
        name: true,
        contentType: true,
        fileSize: true,
        createdAt: true,
        folderId: true,
        clientShare: true,
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const shared = sharedFolderIds(folders);
  const folderName = new Map(folders.map((f) => [f.id, f.name]));
  return docs
    .filter((d) => isEffectivelyShared(d, shared))
    .map((d) => ({
      id: d.id,
      name: d.name,
      contentType: d.contentType,
      fileSize: d.fileSize,
      createdAt: d.createdAt,
      folderName: d.folderId ? (folderName.get(d.folderId) ?? null) : null,
    }));
}

/**
 * The file to stream for a portal download, or null. Allowed when the
 * document is effectively shared, or was uploaded by any identity with live
 * access to the same matter (so clients can re-download what they sent).
 */
export async function canPortalDownload(
  identityId: string,
  documentId: string,
): Promise<{
  fileUrl: string;
  name: string;
  contentType: string | null;
} | null> {
  if (!(await portalIsOn())) return null;
  const doc = await prisma.document.findFirst({
    where: {
      id: documentId,
      status: { not: "archived" },
      matterId: { not: null },
      matter: portalMatterWhere(identityId),
    },
    select: {
      matterId: true,
      name: true,
      fileUrl: true,
      contentType: true,
      folderId: true,
      clientShare: true,
      portalUploaderId: true,
    },
  });
  if (!doc?.matterId || !doc.fileUrl) return null;

  let allowed = false;
  if (doc.portalUploaderId) {
    const uploaderAccess = await prisma.portalMatterAccess.findFirst({
      where: {
        identityId: doc.portalUploaderId,
        matterId: doc.matterId,
        revokedAt: null,
      },
      select: { id: true },
    });
    allowed = !!uploaderAccess;
  }
  if (!allowed) {
    const folders = await prisma.documentFolder.findMany({
      where: { matterId: doc.matterId },
      select: { id: true, parentId: true, clientShared: true },
    });
    allowed = isEffectivelyShared(doc, sharedFolderIds(folders));
  }
  if (!allowed) return null;
  return { fileUrl: doc.fileUrl, name: doc.name, contentType: doc.contentType };
}

/** Files portal users uploaded to the matter, visible to every live-access identity on it. */
export async function listPortalUploads(
  identityId: string,
  matterId: string,
): Promise<PortalUploadRow[]> {
  if (!(await hasLiveAccess(identityId, matterId))) return [];
  const rows = await prisma.document.findMany({
    where: {
      matterId,
      status: { not: "archived" },
      portalUploader: {
        access: { some: { matterId, revokedAt: null } },
      },
    },
    select: {
      id: true,
      name: true,
      fileSize: true,
      createdAt: true,
      documentRequest: { select: { title: true } },
      portalUploader: { select: { email: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    fileSize: r.fileSize,
    createdAt: r.createdAt,
    requestTitle: r.documentRequest?.title ?? null,
    uploaderEmail: r.portalUploader!.email,
  }));
}
