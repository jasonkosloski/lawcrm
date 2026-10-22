/**
 * Documents browser — shared by the matter and intake Documents tabs.
 *
 * Per-record (matter or intake lead) document file system: a collapsible folder tree on the
 * left rail ("All documents" = matter root) and a file browser on
 * the right showing the selected folder's subfolders + files, with
 * breadcrumbs above the list. Selection is URL-driven
 * (`?folder=<id>`) so back/forward and shared links work; an unknown
 * folder id falls back to the root rather than 404ing (the folder
 * may have just been deleted in another tab).
 *
 * This server half loads the folders, the listing and the permission
 * flags and shapes them into rows; DocumentsWorkspace (client) owns
 * the interaction: selection, right-click menus, drag-to-move, desktop
 * file drop. Write affordances render behind read-side permission flags
 * (the server actions re-check regardless): New folder
 * (documents.folder.create), folder rename/delete
 * (documents.folder.edit/.delete), Move/Copy to… and drag-moves
 * (documents.organize), uploads + single-file composer + template
 * generation (documents.upload), delete (uploader or
 * documents.delete_any).
 *
 * File rows link to `{matter|intake}/[id]/documents/[documentId]` — the
 * document viewer route. `writable={false}` (a converted lead) hides
 * the upload, new-folder and generate controls; row actions still
 * gate on their own permission flags.
 */

import { Card, CardContent } from "@/components/ui/card";
import { UploadDocumentForm } from "@/components/matters/documents/upload-document-form";
import {
  getFolderListing,
  type ListingAttachment,
  type ListingRow,
} from "@/lib/queries/document-listing";
import { isProtectedFolder } from "@/lib/records-requests/folder-kinds";
import { FolderSourceBadge } from "@/components/documents/folder-source-badge";
import { GenerateFromTemplateDialog } from "@/components/templates/generate-from-template-dialog";
import { loadGenerateOptions, type GenerateOptions } from "@/lib/templates/generate-options";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { formatDate } from "@/lib/format-date";
import { currentUserHasPermission } from "@/lib/permission-check";
import { activeStorageDriver, type StorageDriver } from "@/lib/file-storage";
import {
  MAX_FOLDER_DEPTH,
  buildFolderTree,
  flattenFolderTree,
  folderDepth,
} from "@/lib/folder-tree";
import { getFolderDocumentCounts, getDocumentFolders } from "@/lib/queries/matter-detail";
import { documentCategoryLabel, documentStatusMeta, formatFileSize } from "@/lib/document-display";
import { docKey, folderKey } from "@/lib/document-selection";
import { scopeBasePath, type RecordScope } from "@/lib/record-scope";
import { ClientShareBadge } from "@/components/documents/client-share-badge";
import {
  isEffectivelyShared,
  shareReason,
  sharedFolderIds,
} from "@/lib/portal/document-visibility";
import { matterHasLivePortalAccess } from "@/lib/queries/document-requests";
import { DocumentsWorkspace } from "@/components/documents/documents-workspace";
import type { DocRowData, FolderRowData, RowData } from "@/components/documents/documents-table";

export async function DocumentsBrowser({
  scope,
  folderParam: rawFolder,
  writable = true,
}: {
  scope: RecordScope;
  /** Raw `?folder=` value; unknown ids fall back to the root. */
  folderParam: string | null;
  /** False hides upload / new-folder / generate (converted lead). */
  writable?: boolean;
}) {
  const [
    folders,
    { counts, rootCount },
    currentUserId,
    canDeleteAny,
    canUpload,
    canFolderCreate,
    canFolderEdit,
    canFolderDelete,
    canOrganize,
    canEdit,
    canSharePermission,
    canViewPortal,
    templates,
    tz,
  ] = await Promise.all([
    getDocumentFolders(scope),
    getFolderDocumentCounts(scope),
    getCurrentUserId(),
    currentUserHasPermission("documents.delete_any"),
    // Gates uploads (multi + composer) and the generate dialog
    // (preview, copy and save all need it).
    currentUserHasPermission("documents.upload"),
    currentUserHasPermission("documents.folder.create"),
    currentUserHasPermission("documents.folder.edit"),
    currentUserHasPermission("documents.folder.delete"),
    currentUserHasPermission("documents.organize"),
    currentUserHasPermission("documents.edit"),
    // Client-portal sharing (matters only — leads have no portal).
    currentUserHasPermission("portal.share_documents"),
    currentUserHasPermission("portal.view"),
    // Active templates only — the generation picker never offers
    // archived ones (soft-archive semantics on DocumentTemplate).
    prisma.documentTemplate.findMany({
      // Letters and filings that fit this record; email/SMS never generate files.
      where: {
        isActive: true,
        kind: { in: ["letter", "filing"] },
        appliesTo: { in: scope.kind === "lead" ? ["lead", "both"] : ["matter", "both"] },
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        category: true,
        description: true,
      },
    }),
    // Upload timestamps are real instants — render them on the
    // viewer's calendar, not the server's (UTC in prod).
    getCurrentUserTimeZone(),
  ]);
  // Signer / recipient choices (access-checked), only when the dialog renders.
  const generateOptions =
    writable && canUpload
      ? await loadGenerateOptions(scope)
      : { team: [], contacts: [], currentUserId: "" };

  const isMatter = scope.kind === "matter";
  // Needs portal.view too: the row's clientShare is only populated for its holders.
  const canShare = isMatter && canSharePermission && canViewPortal;
  // The Shared badge follows portal.view.
  const showShareState = isMatter && canViewPortal;
  const noPortalAccess =
    canSharePermission && scope.kind === "matter"
      ? !(await matterHasLivePortalAccess(scope.matterId))
      : false;
  const sharedFolders = sharedFolderIds(folders);

  // Unknown / stale folder id → root, never a 404.
  const selectedId = rawFolder && folders.some((f) => f.id === rawFolder) ? rawFolder : null;
  // Second round trip on purpose: the file list must be scoped to the
  // VALIDATED folder id, which needs the folder rows first.
  const listing = await getFolderListing(scope, selectedId);

  const tree = buildFolderTree(folders);
  const flat = flattenFolderTree(tree);
  // Ids that have a protected folder somewhere below them.
  const protectedAncestors = new Set<string>();
  for (const f of folders) {
    if (!isProtectedFolder(f)) continue;
    let cur = f.parentId;
    while (cur && !protectedAncestors.has(cur)) {
      protectedAncestors.add(cur);
      cur = folders.find((x) => x.id === cur)?.parentId ?? null;
    }
  }
  // Query orders by (order, name); filter preserves it.
  const subfolders = folders.filter((f) => f.parentId === selectedId);
  const atDepthCap = (id: string | null) =>
    id !== null && folderDepth(folders, id) >= MAX_FOLDER_DEPTH;

  const basePath = `${scopeBasePath(scope)}/documents`;

  const folderRows: FolderRowData[] = subfolders.map((folder) => ({
    key: folderKey(folder.id),
    target: {
      kind: "folder",
      id: folder.id,
      name: folder.name,
      href: `${basePath}?folder=${folder.id}`,
      parentId: folder.parentId,
      isProtected: isProtectedFolder(folder),
      hasProtectedDescendant: protectedAncestors.has(folder.id),
      clientShared: folder.clientShared,
      atDepthCap: atDepthCap(folder.id),
    },
    count: counts[folder.id] ?? 0,
    extras: (
      <>
        <FolderSourceBadge folder={folder} scope={scope} />
        {showShareState && (
          <ClientShareBadge
            reason={
              folder.clientShared
                ? { kind: "file" }
                : shareReason({ clientShare: null, folderId: folder.id }, folders)
            }
          />
        )}
      </>
    ),
  }));

  /** One document row: an ordinary file, or an email's attachment
   *  (indented under it). */
  const docRow = (d: ListingRow, attachments: ListingAttachment[] = []): DocRowData => {
    const status = documentStatusMeta(d.status);
    return {
      key: docKey(d.id),
      parentKey: d.parentDocumentId ? docKey(d.parentDocumentId) : null,
      isEmail: d.isEmail,
      target: {
        kind: "doc",
        id: d.id,
        name: d.name,
        href: `${basePath}/${d.id}`,
        folderId: d.folderId,
        isAttachment: d.parentDocumentId !== null,
        hasFile: d.hasFile,
        canDelete: canDeleteAny || d.uploadedBy === currentUserId,
        category: d.category,
        status: d.status,
        clientShare: d.clientShare,
        isShared: isEffectivelyShared(d, sharedFolders),
        unsavedAttachments: attachments.filter((a) => a.copiedTo.length === 0).map((a) => a.name),
        savedAttachments: attachments.filter((a) => a.copiedTo.length > 0).map((a) => a.name),
        attachmentShares: attachments.map((a) => ({
          clientShare: a.clientShare,
          folderId: a.folderId,
          status: a.status,
        })),
      },
      extras: (
        <>
          {showShareState && d.status !== "archived" && (
            <ClientShareBadge reason={shareReason(d, folders)} />
          )}
          {d.portalUploaderName && (
            <div className="text-2xs font-normal text-ink-3 mt-0.5">
              From {d.portalUploaderName}
              {d.clientNote && (
                <span className="text-ink-4" title={d.clientNote}>
                  {" · "}
                  {d.clientNote.length > 80 ? `${d.clientNote.slice(0, 80)}…` : d.clientNote}
                </span>
              )}
            </div>
          )}
        </>
      ),
      category: documentCategoryLabel(d.category),
      status: { label: status.label, className: status.className },
      size: formatFileSize(d.fileSize),
      uploaderInitials: d.uploaderInitials,
      uploaderName: d.uploaderName,
      added: formatDate(d.createdAt, "medium", tz),
    };
  };

  const rows: RowData[] = [
    ...folderRows,
    ...listing.documents.flatMap((d) => [
      docRow(d, d.attachments),
      ...d.attachments.map((a) => docRow(a)),
    ]),
  ];

  return (
    <DocumentsWorkspace
      scope={scope}
      basePath={basePath}
      folders={folders}
      flat={flat}
      tree={tree}
      counts={counts}
      rootCount={rootCount}
      currentFolderId={selectedId}
      rows={rows}
      perms={{
        organize: canOrganize,
        edit: canEdit,
        folderCreate: canFolderCreate,
        folderEdit: canFolderEdit,
        folderDelete: canFolderDelete,
        upload: canUpload,
        share: canShare,
        writable,
      }}
      storageDriver={activeStorageDriver()}
      visibilityWarnings={isMatter}
      toolbarNote={
        noPortalAccess && (
          <span className="text-2xs text-ink-4">No one has portal access on this matter yet.</span>
        )
      }
      empty={
        <Card>
          <CardContent className="p-8 text-center flex flex-col items-center gap-3">
            <div>
              <div className="text-sm font-semibold text-ink mb-1">
                {selectedId === null ? "No documents yet" : "This folder is empty"}
              </div>
              <div className="text-xs text-ink-3">
                {selectedId === null
                  ? scope.kind === "lead"
                    ? "Screening paperwork, correspondence, and documents received during intake will appear here."
                    : "Filings, pleadings, correspondence, contracts, discovery, and expert reports for this matter will appear here."
                  : "Upload files here or move existing documents into this folder."}
                {writable && canUpload && " You can also drag files here from your computer."}
              </div>
            </div>
          </CardContent>
        </Card>
      }
    >
      {writable && (
        <DocumentComposerRow
          scope={scope}
          templates={templates}
          generateOptions={generateOptions}
          folderId={selectedId}
          canUpload={canUpload}
          storageDriver={activeStorageDriver()}
        />
      )}
    </DocumentsWorkspace>
  );
}

/** Single-file upload composer + template generation side by side.
 *  Kept from the flat-list era — the composer's display-name +
 *  category controls have no multi-file equivalent (composer uploads
 *  land at the root; use "Upload files" to target a folder).
 *  The upload form gets the growing slot so its expanded state keeps
 *  full width; the generate trigger stays a compact button. */
function DocumentComposerRow({
  scope,
  templates,
  generateOptions,
  folderId,
  canUpload,
  storageDriver,
}: {
  scope: RecordScope;
  templates: {
    id: string;
    name: string;
    category: string;
    description: string | null;
  }[];
  generateOptions: GenerateOptions;
  /** Folder open in the browser; generated files are saved into it. */
  folderId: string | null;
  canUpload: boolean;
  storageDriver: StorageDriver;
}) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      {/* Hidden without documents.upload — a denied submit would
          redirect to / and throw away the typed form. */}
      {canUpload && (
        <div className="flex-1 min-w-64">
          <UploadDocumentForm scope={scope} storageDriver={storageDriver} />
        </div>
      )}
      {/* Preview shares generate's documents.upload key. */}
      {canUpload && (
        <GenerateFromTemplateDialog
          scope={scope}
          templates={templates}
          canUpload={canUpload}
          folderId={folderId}
          team={generateOptions.team}
          contacts={generateOptions.contacts}
          currentUserId={generateOptions.currentUserId}
        />
      )}
    </div>
  );
}
