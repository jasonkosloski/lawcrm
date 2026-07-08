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
import { getCurrentUserId } from "@/lib/current-user";
import { requirePermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import { storeFile } from "@/lib/file-storage";
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

export async function fileAttachmentToMatter(
  attachmentId: string,
  matterId: string,
  folderId?: string | null
): Promise<FileAttachmentResult> {
  const userId = await requirePermission("documents.upload");

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

  let sourceKey: string;
  try {
    ({ key: sourceKey } = await ensureAttachmentBytes(attachment.id));
  } catch (err) {
    if (err instanceof AttachmentBytesError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }
  const bytes = await readStoredBytes(sourceKey);

  // Dedupe (heuristic, see module docstring): same attachment
  // already filed to this matter → friendly no-op.
  const existing = await prisma.document.findFirst({
    where: {
      matterId,
      source: "email",
      name: attachment.filename,
      fileSize: bytes.byteLength,
    },
    select: { id: true },
  });
  if (existing) {
    return { ok: true, alreadyFiled: true };
  }

  // Independent copy under its own key — see module docstring.
  const contentType = contentTypeForFilename(attachment.filename);
  const stored = await storeFile(
    new File([new Uint8Array(bytes)], attachment.filename, {
      type: contentType,
    })
  );

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
  const rows = await prisma.documentFolder.findMany({
    where: { matterId },
    select: { id: true, parentId: true, name: true, order: true },
  });
  return flattenFolderTree(buildFolderTree(rows));
}
