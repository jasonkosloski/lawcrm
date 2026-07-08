/**
 * Matter Detail — Documents tab (file browser).
 *
 * Per-matter document file system: a collapsible folder tree on the
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
 * File rows link to /matters/[id]/documents/[documentId] — the
 * document viewer route.
 */

import Link from "next/link";
import { ChevronRight, FileText, Folder } from "lucide-react";
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
import { activeStorageDriver } from "@/lib/file-storage";
import {
  MAX_FOLDER_DEPTH,
  buildFolderTree,
  flattenFolderTree,
  folderDepth,
  folderPath,
} from "@/lib/folder-tree";
import {
  getFolderDocumentCounts,
  getFolderDocuments,
  getMatterDocumentFolders,
} from "@/lib/queries/matter-detail";

const CATEGORY_LABEL: Record<string, string> = {
  filing: "Filing",
  pleading: "Pleading",
  correspondence: "Correspondence",
  contract: "Contract",
  intake: "Intake",
  discovery: "Discovery",
  expert_report: "Expert report",
  evidence: "Evidence",
  vendor: "Vendor",
  archive: "Archive",
  other: "Other",
};

const STATUS_META: Record<string, { label: string; className: string }> = {
  active: {
    label: "Active",
    className: "bg-paper-2 text-ink-3 border-line",
  },
  filed: {
    label: "Filed",
    className: "bg-ok-soft text-ok border-line",
  },
  received: {
    label: "Received",
    className: "bg-brand-soft text-brand-700 border-brand-200",
  },
  review: {
    label: "Under review",
    className: "bg-warn-soft text-warn border-warn-border",
  },
  archived: {
    label: "Archived",
    className: "bg-paper-2 text-ink-4 border-line",
  },
};

const formatSize = (bytes: number | null): string => {
  if (bytes === null || bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default async function MatterDocumentsPage({
  params,
  searchParams,
}: PageProps<"/matters/[id]/documents">) {
  const { id } = await params;
  const sp = await searchParams;
  const rawFolder = typeof sp.folder === "string" ? sp.folder : null;

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
    templates,
    tz,
  ] = await Promise.all([
    getMatterDocumentFolders(id),
    getFolderDocumentCounts(id),
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

  // Unknown / stale folder id → root, never a 404.
  const selectedId =
    rawFolder && folders.some((f) => f.id === rawFolder) ? rawFolder : null;
  // Second round trip on purpose: the file list must be scoped to the
  // VALIDATED folder id, which needs the folder rows first.
  const documents = await getFolderDocuments(id, selectedId);

  const tree = buildFolderTree(folders);
  const flat = flattenFolderTree(tree);
  const crumbs = selectedId ? folderPath(folders, selectedId) : [];
  const selectedName =
    crumbs.length > 0 ? crumbs[crumbs.length - 1]!.name : null;
  // Query orders by (order, name); filter preserves it.
  const subfolders = folders.filter((f) => f.parentId === selectedId);
  const atDepthCap =
    selectedId !== null && folderDepth(folders, selectedId) >= MAX_FOLDER_DEPTH;

  const basePath = `/matters/${id}/documents`;
  const isEmpty = subfolders.length === 0 && documents.length === 0;

  return (
    <div className="p-5 flex flex-col lg:flex-row gap-5 items-start">
      {/* ── Folder tree rail ─────────────────────────────────────── */}
      <div className="w-full lg:w-60 shrink-0">
        <Card className="p-2">
          <FolderTree
            matterId={id}
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
          <div className="ml-auto flex items-center gap-2">
            {canFolderCreate && !atDepthCap && (
              <NewFolderButton
                matterId={id}
                parentId={selectedId}
                parentName={selectedName}
              />
            )}
            {canUpload && (
              <MultiFileUpload
                matterId={id}
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
                    ? "Filings, pleadings, correspondence, contracts, discovery, and expert reports for this matter will appear here."
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
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
                {documents.map((d) => {
                  const status = STATUS_META[d.status] ?? STATUS_META.active;
                  const canDelete =
                    canDeleteAny || d.uploadedBy === currentUserId;
                  return (
                    <TableRow key={d.id}>
                      <TableCell className="pl-4 font-medium text-ink">
                        <Link
                          href={`${basePath}/${d.id}`}
                          className="inline-flex items-center gap-2 hover:text-brand-700 hover:underline"
                          title="Open document"
                        >
                          <FileText
                            size={14}
                            className="shrink-0 text-ink-4"
                          />
                          {d.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-2xs font-mono text-ink-4">
                        {CATEGORY_LABEL[d.category] ?? d.category}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-block text-2xs font-medium px-2 py-0.5 rounded-full border ${status.className}`}
                        >
                          {status.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-2xs font-mono text-ink-3">
                        {formatSize(d.fileSize)}
                      </TableCell>
                      <TableCell className="text-2xs font-mono text-ink-3">
                        <span title={d.uploaderName ?? undefined}>
                          {d.uploaderInitials ?? "—"}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-ink-3">
                        {formatDate(d.createdAt, "medium", tz)}
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        <DocumentRowActions
                          documentId={d.id}
                          name={d.name}
                          canDelete={canDelete}
                          hasFile={d.hasFile}
                          canMove={canOrganize}
                          folders={flat}
                          currentFolderId={d.folderId}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )}

        <DocumentComposerRow
          matterId={id}
          templates={templates}
          canUpload={canUpload}
        />
      </div>
    </div>
  );
}

/** Single-file upload composer + template generation side by side.
 *  Kept from the flat-list era — the composer's display-name +
 *  category controls have no multi-file equivalent (composer uploads
 *  land at the matter root; use "Upload files" to target a folder).
 *  The upload form gets the growing slot so its expanded state keeps
 *  full width; the generate trigger stays a compact button. */
function DocumentComposerRow({
  matterId,
  templates,
  canUpload,
}: {
  matterId: string;
  templates: {
    id: string;
    name: string;
    category: string;
    description: string | null;
  }[];
  canUpload: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      <div className="flex-1 min-w-64">
        <UploadDocumentForm matterId={matterId} />
      </div>
      <GenerateFromTemplateDialog
        matterId={matterId}
        templates={templates}
        canUpload={canUpload}
      />
    </div>
  );
}
