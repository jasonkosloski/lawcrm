/**
 * Document server actions — delete, email-attachment extraction, and
 * "Copy to…" (ADR-043).
 *
 * Uploads do NOT go through a server action: Next caps action bodies
 * at 1 MB by default, and the documents tab handles files up to
 * gigabytes. Every upload path (the single-file composer and the
 * multi-file uploader alike) uses the transport that matches the
 * active storage driver — the busboy streaming route
 * (`src/app/api/documents/upload/route.ts`, local driver) or the
 * client-direct Vercel Blob flow (`.../upload/blob/`, production).
 * Generated documents are filed by `document-templates.ts`.
 *
 * Storage is behind the `src/lib/file-storage.ts` facade (ADR-015):
 * a document's `fileUrl` is a bare key (local) or a full blob URL.
 *
 * Auth model:
 *   - Delete: the original uploader OR anyone holding
 *     `documents.delete_any`. Other members have to ask. This keeps
 *     "I uploaded the wrong PDF" recoverable without making delete a
 *     free-for-all.
 *   - A document carrying flagged moments from OTHER reviewers can
 *     only be deleted by a holder of `evidence.flag.delete_any` —
 *     the row delete cascades every flag, and removing someone
 *     else's flag has its own gate.
 */

"use server";

import { prisma } from "@/lib/prisma";
import { assertChildMatterAccess } from "@/lib/matter-access";
import { revalidateDocumentScope } from "@/lib/scope-access";
import { SAME_SCOPE_ERROR, scopeOf, scopeWhere } from "@/lib/record-scope";
import { getCurrentUserId } from "@/lib/current-user";
import { currentUserHasPermission, requirePermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import { deleteFile } from "@/lib/file-storage";
import { extractEmailAttachments } from "@/lib/email-attachment-extract";


/** What to do with an email's attachments that have no copy anywhere
 *  else when the email is deleted (a copy made with "Copy to…" is its
 *  own document and always stays). */
export type AttachmentChoice = "delete" | "keep";

export async function deleteDocument(
  documentId: string,
  opts: { attachments?: AttachmentChoice } = {}
): Promise<{ ok: boolean; error?: string }> {
  const userId = await getCurrentUserId();
  await assertChildMatterAccess("document", documentId);
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      matterId: true,
      leadId: true,
      name: true,
      fileUrl: true,
      uploadedBy: true,
    },
  });
  if (!doc) return { ok: false, error: "Document not found." };

  // An email's extracted attachments (ADR-043). One that's been copied
  // elsewhere ("saved") lives on as that copy, so it goes with the
  // email; the rest go with it or stay in its folder, as the user chose
  // in the delete prompt.
  const attachments = await prisma.document.findMany({
    where: { parentDocumentId: doc.id },
    select: { id: true, name: true, fileUrl: true },
  });
  const copied = await savedAttachmentIds(doc.id, attachments);
  const unsaved = attachments.filter((a) => !copied.has(a.id));
  const saved = attachments.filter((a) => copied.has(a.id));
  if (unsaved.length > 0 && !opts.attachments) {
    return {
      ok: false,
      error: "Choose whether to delete this email's attachments or keep them.",
    };
  }
  const deletingAttachments = opts.attachments === "keep" ? saved : attachments;

  // Original uploader OR anyone holding `documents.delete_any`
  // (admin always does). Defense against accidental deletion by
  // other team members; the override stays an explicit, gated
  // capability rather than an implicit admin-bypass.
  const canOverride = await currentUserHasPermission(
    "documents.delete_any"
  );
  if (!canOverride && doc.uploadedBy !== userId) {
    return {
      ok: false,
      error:
        "Only the uploader or someone with the Delete-any-document permission can delete this document.",
    };
  }

  // FlaggedMoment.document cascades: deleting the row silently drops
  // every reviewer's flags. Another reviewer's flags may only go with
  // the document when the user could delete them directly.
  const goingIds = [doc.id, ...deletingAttachments.map((a) => a.id)];
  const [totalFlags, otherFlags] = await Promise.all([
    prisma.flaggedMoment.count({ where: { documentId: { in: goingIds } } }),
    prisma.flaggedMoment.count({
      where: { documentId: { in: goingIds }, flaggedById: { not: userId } },
    }),
  ]);
  if (otherFlags > 0) {
    const canDeleteFlags = await currentUserHasPermission(
      "evidence.flag.delete_any"
    );
    if (!canDeleteFlags) {
      return {
        ok: false,
        error: `This document has ${otherFlags} flagged moment${
          otherFlags === 1 ? "" : "s"
        } from other reviewers. Deleting it would remove them, which needs the Delete-anyone's-flags permission.`,
      };
    }
  }

  await prisma.$transaction(async (tx) => {
    if (opts.attachments === "keep") {
      // Stay in the email's folder as ordinary documents.
      await tx.document.updateMany({
        where: { id: { in: unsaved.map((a) => a.id) } },
        data: { parentDocumentId: null, attachmentIndex: null },
      });
    }
    if (deletingAttachments.length > 0) {
      await tx.document.deleteMany({ where: { id: { in: deletingAttachments.map((a) => a.id) } } });
    }
    await tx.document.delete({ where: { id: doc.id } });
  });

  // Audit + revalidate straight after the row delete: the row is
  // gone whatever happens to the bytes, so a storage failure below
  // must not leave the trail empty or the list stale.
  await logActivity({
    matterId: doc.matterId,
    userId,
    type: "document",
    title: "Document deleted",
    detail: [
      doc.name,
      totalFlags > 0 ? `${totalFlags} flagged moment${totalFlags === 1 ? "" : "s"} removed` : null,
      deletingAttachments.length > 0
        ? `with ${deletingAttachments.length} attachment${deletingAttachments.length === 1 ? "" : "s"}`
        : null,
      opts.attachments === "keep" && unsaved.length > 0
        ? `${unsaved.length} attachment${unsaved.length === 1 ? "" : "s"} kept in the folder`
        : null,
      saved.length > 0
        ? `${saved.length} attachment${saved.length === 1 ? "" : "s"} still copied elsewhere`
        : null,
    ]
      .filter(Boolean)
      .join(" — "),
  });

  revalidateDocumentScope(scopeOf(doc));

  // Unlink the stored bytes — best-effort: the DB row is the source
  // of truth and a stray file is recoverable, an unlogged delete is
  // not. Skip when another row still points at the same file (a
  // duplicate would otherwise 410 after its twin is deleted).
  for (const gone of [doc, ...deletingAttachments]) {
    if (!gone.fileUrl) continue;
    try {
      const stillReferenced = await prisma.document.count({
        where: { fileUrl: gone.fileUrl },
      });
      if (stillReferenced === 0) await deleteFile(gone.fileUrl);
    } catch (err) {
      console.error("[deleteDocument] storage cleanup failed", {
        documentId: gone.id,
        key: gone.fileUrl,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { ok: true };
}

// ── Email attachments ─────────────────────────────────────────────────

/** "Add attachments to documents" on an email uploaded before
 *  extraction existed (or whose extraction failed). */
export async function extractAttachments(
  documentId: string
): Promise<{ ok: boolean; error?: string; created?: number }> {
  const userId = await requirePermission("documents.upload");
  await assertChildMatterAccess("document", documentId);
  const res = await extractEmailAttachments(documentId, userId);
  if (!res.ok) return { ok: false, error: res.reason };
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { matterId: true, leadId: true },
  });
  if (doc) revalidateDocumentScope(scopeOf(doc));
  return { ok: true, created: res.created };
}

/** Attachments of `emailId` that have a copy outside the email: another
 *  document (not the email or one of its attachments) sharing the stored
 *  file. Copies share bytes, so the file key identifies them. */
async function savedAttachmentIds(
  emailId: string,
  attachments: { id: string; fileUrl: string | null }[]
): Promise<Set<string>> {
  const keys = attachments.map((a) => a.fileUrl).filter((k): k is string => !!k);
  if (keys.length === 0) return new Set();
  const others = await prisma.document.findMany({
    where: {
      fileUrl: { in: keys },
      id: { notIn: [emailId, ...attachments.map((a) => a.id)] },
      OR: [{ parentDocumentId: null }, { parentDocumentId: { not: emailId } }],
    },
    select: { fileUrl: true },
  });
  const copiedKeys = new Set(others.map((o) => o.fileUrl));
  return new Set(attachments.filter((a) => a.fileUrl && copiedKeys.has(a.fileUrl)).map((a) => a.id));
}

// ── Copy to… ──────────────────────────────────────────────────────────

/**
 * Copy a document into a folder of its matter (`null` = the matter
 * root). The copy is its own document — its own name, folder, status,
 * flags and notes from here on — but shares the stored file, so nothing
 * is uploaded or stored again (deleting either one keeps the bytes
 * while the other still uses them). Copying an email copies its
 * extracted attachments with it.
 */
export async function copyDocumentToFolder(
  documentId: string,
  folderId: string | null
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const userId = await requirePermission("documents.organize");
  await assertChildMatterAccess("document", documentId);
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      matterId: true,
      leadId: true,
      name: true,
      category: true,
      source: true,
      fileUrl: true,
      contentType: true,
      fileSize: true,
      status: true,
      attachmentsExtractedAt: true,
      attachments: {
        select: {
          name: true,
          category: true,
          source: true,
          fileUrl: true,
          contentType: true,
          fileSize: true,
          status: true,
          attachmentIndex: true,
        },
        orderBy: { attachmentIndex: "asc" },
      },
    },
  });
  if (!doc) return { ok: false, error: "Document not found." };

  const scope = scopeOf(doc);
  let folderName = scope.kind === "lead" ? "the intake root" : "the matter root";
  if (folderId) {
    const target = await prisma.documentFolder.findUnique({
      where: { id: folderId },
      select: { name: true, matterId: true, leadId: true },
    });
    if (!target) return { ok: false, error: "Folder not found." };
    // A folder of the other kind (matter vs intake) is a scope breach;
    // a different record of the same kind is simply not found here.
    if (scopeOf(target).kind !== scope.kind) {
      return { ok: false, error: SAME_SCOPE_ERROR };
    }
    const folder = await prisma.documentFolder.findFirst({
      where: { id: folderId, ...scopeWhere(scope) },
      select: { name: true },
    });
    if (!folder) {
      return {
        ok: false,
        error: `Folder not found in this ${scope.kind === "lead" ? "intake" : "matter"}.`,
      };
    }
    folderName = `"${folder.name}"`;
  }

  const copy = await prisma.$transaction(async (tx) => {
    const created = await tx.document.create({
      data: {
        ...scopeWhere(scope),
        folderId,
        name: doc.name,
        category: doc.category,
        source: doc.source,
        fileUrl: doc.fileUrl,
        contentType: doc.contentType,
        fileSize: doc.fileSize,
        status: doc.status,
        uploadedBy: userId,
        attachmentsExtractedAt: doc.attachmentsExtractedAt ? new Date() : null,
      },
      select: { id: true },
    });
    if (doc.attachments.length > 0) {
      await tx.document.createMany({
        data: doc.attachments.map((a) => ({
          ...a,
          ...scopeWhere(scope),
          folderId,
          parentDocumentId: created.id,
          uploadedBy: userId,
        })),
      });
    }
    return created;
  });

  await logActivity({
    matterId: doc.matterId,
    userId,
    type: "document",
    title: "Document copied",
    detail: `${doc.name} → ${folderName}${
      doc.attachments.length > 0
        ? ` (with ${doc.attachments.length} attachment${doc.attachments.length === 1 ? "" : "s"})`
        : ""
    }`,
  });
  revalidateDocumentScope(scope);
  return { ok: true, id: copy.id };
}
