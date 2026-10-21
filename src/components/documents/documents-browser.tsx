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
 * Write affordances render behind read-side permission flags (the
 * server actions re-check regardless): New folder
 * (documents.folder.create), folder rename/delete
 * (documents.folder.edit/.delete), Move to… on files + folders
 * (documents.organize), multi-file upload into the current folder +
 * single-file composer + template generation (documents.upload),
 * delete (uploader or documents.delete_any).
 *
 * File rows link to `{matter|intake}/[id]/documents/[documentId]` — the
 * document viewer route. `writable={false}` (a converted lead) hides
 * the upload, new-folder and generate controls; row actions still
 * gate on their own permission flags.
 */

import Link from "next/link";
import { ChevronRight, FileText, Folder, Mail, Paperclip } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UploadDocumentForm } from "@/components/matters/documents/upload-document-form";
import { DocumentRowActions } from "@/components/matters/documents/document-row-actions";
import {
  getFolderListing,
  type ListingAttachment,
  type ListingRow,
} from "@/lib/queries/document-listing";
import { isProtectedFolder } from "@/lib/records-requests/folder-kinds";
import { FolderSourceBadge } from "@/components/documents/folder-source-badge";
import { FolderRowActions } from "@/components/matters/documents/folder-row-actions";
import { FolderTree } from "@/components/matters/documents/folder-tree";
import { MultiFileUpload } from "@/components/matters/documents/multi-file-upload";
import { NewFolderButton } from "@/components/matters/documents/new-folder-button";
import { GenerateFromTemplateDialog } from "@/components/templates/generate-from-template-dialog";
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
  folderPath,
} from "@/lib/folder-tree";
import {
  getFolderDocumentCounts,
  getDocumentFolders,
} from "@/lib/queries/matter-detail";
import {
  documentCategoryLabel,
  documentStatusMeta,
  formatFileSize,
} from "@/lib/document-display";
import { scopeBasePath, type RecordScope } from "@/lib/record-scope";
import { ClientShareBadge } from "@/components/documents/client-share-badge";
import { isEffectivelyShared, shareReason, sharedFolderIds } from "@/lib/portal/document-visibility";
import { matterHasLivePortalAccess } from "@/lib/queries/document-requests";

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
    canSharePermission,
    canViewPortal,
    templates,
    tz,
  ] = await Promise.all([
    getDocumentFolders(scope),
    getFolderDocumentCounts(scope),
    getCurrentUserId(),
    currentUserHasPermission("documents.delete_any"),
    // Gates uploads (multi + composer) and the generate dialog's
    // "Save to documents" affordance — previewing/copying merged
    // text stays open to everyone.
    currentUserHasPermission("documents.upload"),
    currentUserHasPermission("documents.folder.create"),
    currentUserHasPermission("documents.folder.edit"),
    currentUserHasPermission("documents.folder.delete"),
    currentUserHasPermission("documents.organize"),
    // Client-portal sharing (matters only — leads have no portal).
    currentUserHasPermission("portal.share_documents"),
    currentUserHasPermission("portal.view"),
    // Active templates only — the generation picker never offers
    // archived ones (soft-archive semantics on DocumentTemplate).
    prisma.documentTemplate.findMany({
      where: { isActive: true },
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
  const selectedId =
    rawFolder && folders.some((f) => f.id === rawFolder) ? rawFolder : null;
  // Second round trip on purpose: the file list must be scoped to the
  // VALIDATED folder id, which needs the folder rows first.
  const listing = await getFolderListing(scope, selectedId);

  const tree = buildFolderTree(folders);
  const flat = flattenFolderTree(tree);
  const crumbs = selectedId ? folderPath(folders, selectedId) : [];
  const selectedName =
    crumbs.length > 0 ? crumbs[crumbs.length - 1]!.name : null;
  // Query orders by (order, name); filter preserves it.
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
  const subfolders = folders.filter((f) => f.parentId === selectedId);
  const atDepthCap =
    selectedId !== null && folderDepth(folders, selectedId) >= MAX_FOLDER_DEPTH;

  const basePath = `${scopeBasePath(scope)}/documents`;
  const isEmpty = subfolders.length === 0 && listing.documents.length === 0;

  /** One document row: an ordinary file, or an email's attachment
   *  (indented under it). */
  const docRow = (d: ListingRow, kind: "own" | "attachment", attachments: ListingAttachment[] = []) => {
    const status = documentStatusMeta(d.status);
    const canDelete = canDeleteAny || d.uploadedBy === currentUserId;
    const Icon = kind === "attachment" ? Paperclip : d.isEmail ? Mail : FileText;
    return (
      <TableRow key={d.id}>
        <TableCell className={kind === "attachment" ? "pl-10 font-medium text-ink" : "pl-4 font-medium text-ink"}>
          <Link
            href={`${basePath}/${d.id}`}
            className="inline-flex items-center gap-2 hover:text-brand-700 hover:underline"
            title="Open document"
          >
            <Icon size={14} className="shrink-0 text-ink-4" />
            {d.name}
          </Link>
          {showShareState && d.status !== "archived" && <ClientShareBadge reason={shareReason(d, folders)} />}
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
        </TableCell>
        <TableCell className="text-xs text-ink-3">{documentCategoryLabel(d.category)}</TableCell>
        <TableCell>
          <span className={`inline-block text-2xs font-medium px-2 py-0.5 rounded-full ${status.className}`}>
            {status.label}
          </span>
        </TableCell>
        <TableCell className="text-2xs font-mono text-ink-3">{formatFileSize(d.fileSize)}</TableCell>
        <TableCell className="text-2xs font-mono text-ink-3">
          <span title={d.uploaderName ?? undefined}>{d.uploaderInitials ?? "—"}</span>
        </TableCell>
        <TableCell className="text-xs text-ink-3">{formatDate(d.createdAt, "medium", tz)}</TableCell>
        <TableCell className="pr-4 text-right">
          <DocumentRowActions
            documentId={d.id}
            name={d.name}
            canDelete={canDelete}
            hasFile={d.hasFile}
            canMove={canOrganize}
            folders={flat}
            currentFolderId={d.folderId}
            isAttachment={d.parentDocumentId !== null}
            unsavedAttachments={attachments.filter((a) => a.copiedTo.length === 0).map((a) => a.name)}
            savedAttachments={attachments.filter((a) => a.copiedTo.length > 0).map((a) => a.name)}
            canShare={canShare}
            isShared={isEffectivelyShared(d, sharedFolders)}
            clientShare={d.clientShare}
            status={d.status}
            attachmentShares={attachments.map((a) => ({
              clientShare: a.clientShare,
              folderId: a.folderId,
              status: a.status,
            }))}
            visibilityFolders={isMatter ? folders : undefined}
          />
        </TableCell>
      </TableRow>
    );
  };

  return (
    <div className="p-5 flex flex-col lg:flex-row gap-5 items-start">
      {/* ── Folder tree rail ─────────────────────────────────────── */}
      <div className="w-full lg:w-60 shrink-0">
        <Card className="p-2">
          <FolderTree
            scope={scope}
            tree={tree}
            counts={counts}
            rootCount={rootCount}
            selectedId={selectedId}
          />
        </Card>
      </div>

      {/* ── Browser ──────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 w-full flex flex-col gap-4">
        {/* Breadcrumbs + toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <nav
            aria-label="Folder path"
            className="flex items-center gap-1 min-w-0 text-xs"
          >
            <Link
              href={basePath}
              className={
                selectedId === null
                  ? "font-semibold text-ink"
                  : "text-ink-3 hover:text-brand-700 hover:underline"
              }
            >
              All documents
            </Link>
            {crumbs.map((crumb, i) => {
              const isLast = i === crumbs.length - 1;
              return (
                <span
                  key={crumb.id}
                  className="flex items-center gap-1 min-w-0"
                >
                  <ChevronRight size={12} className="shrink-0 text-ink-4" />
                  {isLast ? (
                    <span className="font-semibold text-ink truncate">
                      {crumb.name}
                    </span>
                  ) : (
                    <Link
                      href={`${basePath}?folder=${crumb.id}`}
                      className="text-ink-3 hover:text-brand-700 hover:underline truncate"
                    >
                      {crumb.name}
                    </Link>
                  )}
                </span>
              );
            })}
          </nav>
          {noPortalAccess && (
            <span className="text-2xs text-ink-4">
              No one has portal access on this matter yet.
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {writable && canFolderCreate && !atDepthCap && (
              <NewFolderButton
                scope={scope}
                parentId={selectedId}
                parentName={selectedName}
              />
            )}
            {writable && canUpload && (
              <MultiFileUpload
                scope={scope}
                folderId={selectedId}
                folderName={selectedName}
                // Transport selector: local → streaming XHR route,
                // vercel-blob → client-direct upload (client
                // components can't read env, so the server decides).
                storageDriver={activeStorageDriver()}
              />
            )}
          </div>
        </div>

        {/* Folder contents */}
        {isEmpty ? (
          <Card>
            <CardContent className="p-8 text-center flex flex-col items-center gap-3">
              <div>
                <div className="text-sm font-semibold text-ink mb-1">
                  {selectedId === null
                    ? "No documents yet"
                    : "This folder is empty"}
                </div>
                <div className="text-xs text-ink-3">
                  {selectedId === null
                    ? scope.kind === "lead"
                      ? "Screening paperwork, correspondence, and documents received during intake will appear here."
                      : "Filings, pleadings, correspondence, contracts, discovery, and expert reports for this matter will appear here."
                    : "Upload files here or move existing documents into this folder."}
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="p-0 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="pr-4 w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {subfolders.map((folder) => {
                  const count = counts[folder.id] ?? 0;
                  return (
                    <TableRow key={folder.id}>
                      <TableCell className="pl-4 font-medium text-ink">
                        <Link
                          href={`${basePath}?folder=${folder.id}`}
                          className="inline-flex items-center gap-2 hover:text-brand-700"
                        >
                          <Folder size={14} className="shrink-0 text-ink-4" />
                          {folder.name}
                          {count > 0 && (
                            <span className="text-2xs font-mono font-normal text-ink-4">
                              {count} file{count === 1 ? "" : "s"}
                            </span>
                          )}
                        </Link>
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
                      </TableCell>
                      <TableCell className="text-2xs font-mono text-ink-4">
                        Folder
                      </TableCell>
                      <TableCell className="text-2xs text-ink-4">—</TableCell>
                      <TableCell className="text-2xs text-ink-4">—</TableCell>
                      <TableCell className="text-2xs text-ink-4">—</TableCell>
                      <TableCell className="text-2xs text-ink-4">—</TableCell>
                      <TableCell className="pr-4 text-right">
                        <FolderRowActions
                          folderId={folder.id}
                          name={folder.name}
                          parentId={folder.parentId}
                          folders={flat}
                          canEdit={canFolderEdit}
                          canDelete={canFolderDelete}
                          canOrganize={canOrganize}
                          isProtected={isProtectedFolder(folder)}
                          hasProtectedDescendant={protectedAncestors.has(
                            folder.id
                          )}
                          canShare={canShare}
                          clientShared={folder.clientShared}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
                {listing.documents.map((d) => [
                  docRow(d, "own", d.attachments),
                  ...d.attachments.map((a) => docRow(a, "attachment")),
                ])}
              </TableBody>
            </Table>
          </Card>
        )}

        {writable && (
          <DocumentComposerRow
            scope={scope}
            templates={templates}
            canUpload={canUpload}
            storageDriver={activeStorageDriver()}
          />
        )}
      </div>
    </div>
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
  canUpload: boolean;
  storageDriver: StorageDriver;
}) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      {/* Hidden without documents.upload — a denied submit would
          redirect to / and throw away the typed form. */}
      {canUpload && (
        <div className="flex-1 min-w-64">
          <UploadDocumentForm
            scope={scope}
            storageDriver={storageDriver}
          />
        </div>
      )}
      <GenerateFromTemplateDialog
        scope={scope}
        templates={templates}
        canUpload={canUpload}
      />
    </div>
  );
}
