/**
 * Document server actions — delete.
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
import { getCurrentUserId } from "@/lib/current-user";
import { currentUserHasPermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import { deleteFile } from "@/lib/file-storage";

export async function deleteDocument(
  documentId: string
): Promise<{ ok: boolean; error?: string }> {
  const userId = await getCurrentUserId();
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
  const [totalFlags, otherFlags] = await Promise.all([
    prisma.flaggedMoment.count({ where: { documentId: doc.id } }),
    prisma.flaggedMoment.count({
      where: { documentId: doc.id, flaggedById: { not: userId } },
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

  await prisma.document.delete({ where: { id: doc.id } });

  // Audit + revalidate straight after the row delete: the row is
  // gone whatever happens to the bytes, so a storage failure below
  // must not leave the trail empty or the list stale.
  await logActivity({
    matterId: doc.matterId,
    userId,
    type: "document",
    title: "Document deleted",
    detail:
      totalFlags > 0
        ? `${doc.name} (${totalFlags} flagged moment${
            totalFlags === 1 ? "" : "s"
          } removed)`
        : doc.name,
  });

  revalidatePath(`/matters/${doc.matterId}/documents`);
  revalidatePath(`/matters/${doc.matterId}`);

  // Unlink the stored bytes — best-effort: the DB row is the source
  // of truth and a stray file is recoverable, an unlogged delete is
  // not. Skip when another row still points at the same file (a
  // duplicate would otherwise 410 after its twin is deleted).
  if (doc.fileUrl) {
    try {
      const stillReferenced = await prisma.document.count({
        where: { fileUrl: doc.fileUrl },
      });
      if (stillReferenced === 0) await deleteFile(doc.fileUrl);
    } catch (err) {
      console.error("[deleteDocument] storage cleanup failed", {
        documentId: doc.id,
        key: doc.fileUrl,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { ok: true };
}
