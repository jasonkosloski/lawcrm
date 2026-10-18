/**
 * Email-attachment actions — the attachment→matter-documents bridge
 * (Email v1.1).
 *
 * `fileAttachmentToMatter` turns an inbox attachment into a real
 * Document row on a matter: ensures the bytes are cached (shared
 * fetch-on-demand path in `src/lib/email-attachments.ts`), then
 * writes a COPY of the bytes under a fresh storage key. The copy is
 * deliberate — `deleteDocument` unlinks the row's `fileUrl`, so a
 * Document sharing the attachment's key (or another filing's) would
 * let one delete break every other reference. Attachment-scale
 * bytes (Gmail caps ~25MB) make the duplication cheap.
 *
 * Trust stance on metadata (mirrors the upload route):
 *   - `contentType` is re-derived server-side from the FILENAME
 *     extension (`contentTypeForFilename`) — the Gmail-declared
 *     `EmailAttachment.contentType` is sender-controlled and is
 *     deliberately not copied onto the Document.
 *   - category "correspondence" (it arrived as mail), source
 *     "email", name = the attachment's filename.
 *
 * Dedupe: re-filing the SAME attachment to the SAME matter no-ops
 * with `alreadyFiled: true` (friendly toast, no duplicate row, no
 * duplicate activity entry). Detection is heuristic — an existing
 * `source: "email"` Document on the matter with the same name +
 * byte size — because Document carries no attachment FK (no schema
 * change in this phase). Filing to a DIFFERENT matter is a new,
 * independent copy on purpose.
 *
 * Scoping: the attachment must live in one of the CURRENT user's
 * mailboxes (`account.userId`), matching the `getThreadById` read
 * model — you can only file what your inbox lets you read.
 *
 * `listMatterFolders` is the small read the filing dialog uses to
 * populate its folder picker after a matter is chosen. Session-
 * gated only (folder names are matter-record metadata any member's
 * Documents tab already shows).
 */

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getDocumentFolders } from "@/lib/queries/matter-detail";
import { assertMatterAccess } from "@/lib/matter-access";
import { getCurrentUserId } from "@/lib/current-user";
import { requirePermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import { deleteFile, storeFile } from "@/lib/file-storage";
import {
  AttachmentBytesError,
  ensureAttachmentBytes,
  readStoredBytes,
} from "@/lib/email-attachments";
import { contentTypeForFilename } from "@/app/api/documents/upload/upload-config";
import {
  buildFolderTree,
  flattenFolderTree,
  type FlatFolder,
} from "@/lib/folder-tree";

export type FileAttachmentResult = {
  ok: boolean;
  error?: string;
  /** True when the attachment was already on this matter — the call
   *  no-oped (nothing created, nothing logged). */
  alreadyFiled?: boolean;
};

const FILING_FAILED_ERROR = "Could not file the attachment - try again.";

export async function fileAttachmentToMatter(
  attachmentId: string,
  matterId: string,
  folderId?: string | null
): Promise<FileAttachmentResult> {
  const userId = await requirePermission("documents.upload");
  await assertMatterAccess(matterId);

  // Owner-scoped resolve — mirrors the download route + read model.
  const attachment = await prisma.emailAttachment.findFirst({
    where: {
      id: attachmentId,
      message: { thread: { account: { userId } } },
    },
    select: { id: true, filename: true },
  });
  if (!attachment) return { ok: false, error: "Attachment not found." };

  const matter = await prisma.matter.findUnique({
    where: { id: matterId },
    select: { id: true },
  });
  if (!matter) return { ok: false, error: "Matter not found." };

  const targetFolderId = folderId?.trim() || null;
  if (targetFolderId) {
    // Scoped find — a folderId from a different matter must not let
    // the file leak into that matter's tree (same rule as uploads).
    const folder = await prisma.documentFolder.findFirst({
      where: { id: targetFolderId, matterId },
      select: { id: true },
    });
    if (!folder) {
      return { ok: false, error: "Folder not found in this matter." };
    }
  }

  const isAlreadyFiled = async (size: number): Promise<boolean> =>
    (await prisma.document.findFirst({
      where: {
        matterId,
        source: "email",
        name: attachment.filename,
        fileSize: size,
      },
      select: { id: true },
    })) !== null;

  let sourceKey: string;
  try {
    ({ key: sourceKey } = await ensureAttachmentBytes(attachment.id));
  } catch (err) {
    if (err instanceof AttachmentBytesError) {
      return { ok: false, error: err.message };
    }
    console.error("[email-attachments] could not cache attachment", err);
    return { ok: false, error: FILING_FAILED_ERROR };
  }

  // Cheap dedupe first: ensureAttachmentBytes backfills
  // EmailAttachment.fileSize with the true byte count, so a repeat
  // filing of a large attachment needn't download it from storage
  // just to no-op. (Re-checked below with the real size - the stored
  // size can be Gmail's claim on older rows.)
  const cached = await prisma.emailAttachment.findUnique({
    where: { id: attachment.id },
    select: { fileSize: true },
  });
  if (cached?.fileSize != null && (await isAlreadyFiled(cached.fileSize))) {
    return { ok: true, alreadyFiled: true };
  }

  const contentType = contentTypeForFilename(attachment.filename);
  let storedKey: string | null = null;
  try {
    const bytes = await readStoredBytes(sourceKey);

    // Dedupe (heuristic, see module docstring): same attachment
    // already filed to this matter → friendly no-op.
    if (await isAlreadyFiled(bytes.byteLength)) {
      return { ok: true, alreadyFiled: true };
    }

    // Independent copy under its own key — see module docstring.
    const stored = await storeFile(
      new File([new Uint8Array(bytes)], attachment.filename, {
        type: contentType,
      })
    );
    storedKey = stored.key;

    await prisma.document.create({
      data: {
        matterId,
        folderId: targetFolderId,
        name: attachment.filename,
        category: "correspondence",
        source: "email",
        fileUrl: stored.key,
        contentType,
        fileSize: stored.size,
        uploadedBy: userId,
      },
      select: { id: true },
    });
  } catch (err) {
    console.error("[email-attachments] filing failed", err);
    // Don't orphan the copy when the row never got written.
    if (storedKey) await deleteFile(storedKey).catch(() => undefined);
    return { ok: false, error: FILING_FAILED_ERROR };
  }

  await logActivity({
    matterId,
    userId,
    type: "document",
    title: "Filed email attachment",
    detail: attachment.filename,
  });

  revalidatePath(`/matters/${matterId}/documents`);
  revalidatePath(`/matters/${matterId}`);
  return { ok: true };
}

/** Flattened folder tree for a matter — feeds the filing dialog's
 *  folder picker (fetched after the matter is chosen, so it can't
 *  ride in as page props). Session-gated read. */
export async function listMatterFolders(
  matterId: string
): Promise<FlatFolder[]> {
  await getCurrentUserId();
  await assertMatterAccess(matterId);
  const rows = await getDocumentFolders({ kind: "matter", matterId });
  return flattenFolderTree(buildFolderTree(rows));
}
