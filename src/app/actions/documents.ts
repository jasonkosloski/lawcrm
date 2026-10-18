/**
 * Document server actions — delete, email-attachment extraction, and
 * extra folder links (ADR-043).
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

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { assertChildMatterAccess } from "@/lib/matter-access";
import { getCurrentUserId } from "@/lib/current-user";
import { currentUserHasPermission, requirePermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import { deleteFile } from "@/lib/file-storage";
import { extractEmailAttachments } from "@/lib/email-attachment-extract";

/** Refresh the Documents tab AND every document viewer page under it
 *  (each viewer shows the matter's file tree), plus the overview. */
function revalidateDocuments(matterId: string) {
  revalidatePath(`/matters/${matterId}/documents`, "layout");
  revalidatePath(`/matters/${matterId}`);
}

/** What to do with an email's attachments that aren't filed anywhere
 *  else when the email is deleted (attachments that ARE filed elsewhere
 *  always stay there). */
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
      name: true,
      fileUrl: true,
      uploadedBy: true,
    },
  });
  if (!doc) return { ok: false, error: "Document not found." };

  // An email's extracted attachments (ADR-043). Ones also filed in
  // another folder stay there; the rest go with the email or stay in
  // its folder, as the user chose in the delete prompt.
  const attachments = await prisma.document.findMany({
    where: { parentDocumentId: doc.id },
    select: {
      id: true,
      name: true,
      fileUrl: true,
      links: { select: { id: true, folderId: true }, orderBy: { createdAt: "asc" } },
    },
  });
  const unsaved = attachments.filter((a) => a.links.length === 0);
  const saved = attachments.filter((a) => a.links.length > 0);
  if (unsaved.length > 0 && !opts.attachments) {
    return {
      ok: false,
      error: "Choose whether to delete this email's attachments or keep them.",
    };
  }
  const deletingAttachments = opts.attachments === "delete" ? unsaved : [];

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
    // Filed elsewhere: its first extra location becomes its home.
    for (const a of saved) {
      const [home] = a.links;
      await tx.document.update({
        where: { id: a.id },
        data: { parentDocumentId: null, attachmentIndex: null, folderId: home.folderId },
      });
      await tx.documentLink.delete({ where: { id: home.id } });
    }
    if (opts.attachments === "keep") {
      // Stay in the email's folder as ordinary documents.
      await tx.document.updateMany({
        where: { id: { in: unsaved.map((a) => a.id) } },
        data: { parentDocumentId: null, attachmentIndex: null },
      });
    } else if (deletingAttachments.length > 0) {
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
        ? `${saved.length} attachment${saved.length === 1 ? "" : "s"} kept where filed`
        : null,
    ]
      .filter(Boolean)
      .join(" — "),
  });

  revalidateDocuments(doc.matterId);

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
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { matterId: true } });
  if (doc) revalidateDocuments(doc.matterId);
  return { ok: true, created: res.created };
}

// ── Extra folder links ────────────────────────────────────────────────

/** File a document in one more folder of its matter (`null` = the
 *  matter root) — the same document, no new copy. */
export async function addDocumentLink(
  documentId: string,
  folderId: string | null
): Promise<{ ok: boolean; error?: string }> {
  const userId = await requirePermission("documents.organize");
  await assertChildMatterAccess("document", documentId);
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true, matterId: true, name: true, folderId: true, parentDocumentId: true },
  });
  if (!doc) return { ok: false, error: "Document not found." };

  let folderName = "the matter root";
  if (folderId) {
    const folder = await prisma.documentFolder.findFirst({
      where: { id: folderId, matterId: doc.matterId },
      select: { name: true },
    });
    if (!folder) return { ok: false, error: "Folder not found in this matter." };
    folderName = `"${folder.name}"`;
  }
  // Already shown there as itself (an attachment's home is under its
  // email, so a link in the email's folder is still a new place).
  if (!doc.parentDocumentId && doc.folderId === folderId) {
    return { ok: false, error: "The document is already in that folder." };
  }
  const existing = await prisma.documentLink.findFirst({ where: { documentId, folderId } });
  if (existing) return { ok: false, error: "The document is already filed in that folder." };

  await prisma.documentLink.create({
    data: { documentId, matterId: doc.matterId, folderId, createdById: userId },
  });
  await logActivity({
    matterId: doc.matterId,
    userId,
    type: "document",
    title: "Document also filed",
    detail: `${doc.name} → ${folderName}`,
  });
  revalidateDocuments(doc.matterId);
  return { ok: true };
}

/** Take a document out of one of its extra folders. The document (and
 *  its other places) are untouched. */
export async function removeDocumentLink(linkId: string): Promise<{ ok: boolean; error?: string }> {
  const userId = await requirePermission("documents.organize");
  const link = await prisma.documentLink.findUnique({
    where: { id: linkId },
    select: { id: true, documentId: true, matterId: true, document: { select: { name: true } }, folder: { select: { name: true } } },
  });
  if (!link) return { ok: false, error: "That folder link is already gone." };
  await assertChildMatterAccess("document", link.documentId);
  await prisma.documentLink.delete({ where: { id: link.id } });
  await logActivity({
    matterId: link.matterId,
    userId,
    type: "document",
    title: "Document removed from a folder",
    detail: `${link.document.name} — no longer in ${link.folder ? `"${link.folder.name}"` : "the matter root"}`,
  });
  revalidateDocuments(link.matterId);
  return { ok: true };
}
