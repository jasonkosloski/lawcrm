/**
 * Matter Detail — Documents tab readers (rows, folders, counts).
 */

import { scopeWhere, type RecordScope } from "@/lib/record-scope";
import { prisma } from "@/lib/prisma";
import { currentUserHasPermission } from "@/lib/permission-check";

// ── Documents ────────────────────────────────────────────────────────────

export type DocumentRow = {
  id: string;
  name: string;
  category: string;
  source: string | null;
  status: string;
  fileSize: number | null;
  contentType: string | null;
  /** True when the document has actual bytes attached. Seeded
   *  fixtures don't (they were created before upload was wired) —
   *  the row UI hides Download for those. */
  hasFile: boolean;
  /** Original uploader's user id; null on seeded / programmatically-
   *  created rows. Drives the "can I delete this?" check on the
   *  row actions menu. */
  uploadedBy: string | null;
  /** Pre-resolved display name for the uploader so the row can show
   *  "by JK" without a second query. */
  uploaderInitials: string | null;
  /** Uploader's full name — tooltip / accessible label next to the
   *  initials. Null on seeded rows or deleted users. */
  uploaderName: string | null;
  /** Folder within the matter's file tree; null = matter root. */
  folderId: string | null;
  /** The email this file was extracted from (ADR-043), else null. */
  parentDocumentId: string | null;
  /** Portal visibility override: null follows the folder, "shared" /
   *  "hidden" is the per-file choice. Staff UI only (portal.view). */
  clientShare: string | null;
  /** Contact name of the portal user who uploaded this ("From <name>"). */
  portalUploaderName: string | null;
  /** The client's note on their upload. */
  clientNote: string | null;
  createdAt: Date;
};

/** Batch-resolve uploader initials + names (one query, no N+1) and
 *  shape raw Document rows into DocumentRow. */
export async function shapeDocumentRows(
  rows: Awaited<ReturnType<typeof prisma.document.findMany>>
): Promise<DocumentRow[]> {
  const uploaderIds = [
    ...new Set(rows.map((d) => d.uploadedBy).filter((v): v is string => !!v)),
  ];
  const uploaders =
    uploaderIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: uploaderIds } },
          select: { id: true, initials: true, name: true },
        })
      : [];
  const byUser = new Map(uploaders.map((u) => [u.id, u]));

  // Portal sharing state and client-upload attribution are staff-portal
  // data: only portal.view holders get them.
  const canViewPortal = await currentUserHasPermission("portal.view");
  const portalIds = canViewPortal
    ? [...new Set(rows.map((d) => d.portalUploaderId).filter((v): v is string => !!v))]
    : [];
  const portalUploaders =
    portalIds.length > 0
      ? await prisma.portalIdentity.findMany({
          where: { id: { in: portalIds } },
          select: { id: true, contact: { select: { name: true } } },
        })
      : [];
  const portalNames = new Map(portalUploaders.map((p) => [p.id, p.contact.name]));

  return rows.map((d) => ({
    id: d.id,
    name: d.name,
    category: d.category,
    source: d.source,
    status: d.status,
    fileSize: d.fileSize,
    contentType: d.contentType,
    hasFile: !!d.fileUrl,
    uploadedBy: d.uploadedBy,
    uploaderInitials: d.uploadedBy
      ? byUser.get(d.uploadedBy)?.initials ?? null
      : null,
    uploaderName: d.uploadedBy ? byUser.get(d.uploadedBy)?.name ?? null : null,
    folderId: d.folderId,
    parentDocumentId: d.parentDocumentId,
    clientShare: canViewPortal ? d.clientShare : null,
    portalUploaderName: canViewPortal && d.portalUploaderId
      ? (portalNames.get(d.portalUploaderId) ?? null)
      : null,
    clientNote: canViewPortal ? d.clientNote : null,
    createdAt: d.createdAt,
  }));
}

/** The matter's whole folder tree as FLAT rows in ONE query — tree
 *  building (nesting, breadcrumbs, depth math) happens in JS via
 *  src/lib/folder-tree.ts. */
export async function getDocumentFolders(
  scope: RecordScope
): Promise<
  {
    id: string;
    parentId: string | null;
    name: string;
    order: number;
    systemKind: string | null;
    /** Folder-level client-portal share flag (staff UI). */
    clientShared: boolean;
    recordsRequestId: string | null;
    /** Subject of the owning records request, for the badge tooltip. */
    sourceTitle: string | null;
  }[]
> {
  const rows = await prisma.documentFolder.findMany({
    where: scopeWhere(scope),
    select: {
      id: true,
      parentId: true,
      name: true,
      order: true,
      systemKind: true,
      clientShared: true,
      recordsRequestId: true,
      recordsRequest: { select: { subject: true } },
    },
    orderBy: [{ order: "asc" }, { name: "asc" }],
  });
  return rows.map(({ recordsRequest, ...f }) => ({
    ...f,
    sourceTitle: recordsRequest?.subject ?? null,
  }));
}

/** Direct (non-recursive) document count per folder in one groupBy.
 *  The root's count lives under the `root` key (groupBy can't key a
 *  Record on null). Drives the count badges on the tree rail. */
export async function getFolderDocumentCounts(
  scope: RecordScope
): Promise<{ counts: Record<string, number>; rootCount: number }> {
  // An email counts once — its attachments list under it.
  const grouped = await prisma.document.groupBy({
    by: ["folderId"],
    where: { ...scopeWhere(scope), parentDocumentId: null },
    _count: { _all: true },
  });
  const counts: Record<string, number> = {};
  let rootCount = 0;
  for (const g of grouped) {
    if (g.folderId === null) rootCount = g._count._all;
    else counts[g.folderId] = g._count._all;
  }
  return { counts, rootCount };
}
