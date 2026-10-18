/**
 * Extract an uploaded email's attachments into documents (ADR-043).
 *
 * Each attachment of a .eml/.msg document becomes its own Document:
 * stored under its own key, `parentDocumentId` = the email, the
 * email's folder, `attachmentIndex` = its position in the email's
 * attachment list (so the viewer's chips open it). It's then a real
 * document — viewable, flaggable, and fileable in other folders
 * through DocumentLinks — without anyone uploading it again.
 *
 * Runs automatically after an email upload (both upload transports)
 * and from the email viewer's "Add attachments to documents" button
 * for emails uploaded before this existed. Idempotent: the email's
 * `attachmentsExtractedAt` is claimed atomically first, so two runs
 * can't both extract. On failure everything written is rolled back and
 * the claim released, so the button can try again.
 *
 * NOT a server action (callers gate it): the upload paths have
 * already authorized the uploader, and the button's action checks
 * `documents.upload` + matter access before calling in.
 */

import { prisma } from "@/lib/prisma";
import { deleteFile, statFile, storeFile } from "@/lib/file-storage";
import { readStoredBytes } from "@/lib/document-preview";
import { EMAIL_MAX_BYTES, readEmailFiles } from "@/lib/office-preview";
import { resolveDocumentRenderer } from "@/components/documents-viewer/resolve-renderer";
import { capDocumentName, contentTypeForFilename } from "@/app/api/documents/upload/upload-config";
import { logActivity } from "@/lib/activity-log";

/** Attachments extracted per email; past this the rest stay inside
 *  the email file (still downloadable with it). */
export const MAX_EXTRACTED_ATTACHMENTS = 100;

export type ExtractResult =
  | { ok: true; created: number; alreadyExtracted?: boolean }
  | { ok: false; reason: string };

/** "eml" / "msg" for an email document, else null. */
export function emailKindOf(contentType: string | null, name: string): "eml" | "msg" | null {
  const r = resolveDocumentRenderer(contentType, name);
  return r === "eml" || r === "msg" ? r : null;
}

export async function extractEmailAttachments(documentId: string, actorId: string): Promise<ExtractResult> {
  const email = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true, matterId: true, folderId: true, name: true, contentType: true, fileUrl: true, category: true },
  });
  if (!email?.fileUrl) return { ok: false, reason: "Email not found." };
  const kind = emailKindOf(email.contentType, email.name);
  if (!kind) return { ok: false, reason: "This document isn't an email file." };

  // Claim the email (atomic): only one run extracts.
  const claim = await prisma.document.updateMany({
    where: { id: email.id, attachmentsExtractedAt: null },
    data: { attachmentsExtractedAt: new Date() },
  });
  if (claim.count === 0) return { ok: true, created: 0, alreadyExtracted: true };
  const release = () =>
    prisma.document.updateMany({ where: { id: email.id }, data: { attachmentsExtractedAt: null } });

  const stored: string[] = [];
  try {
    const stat = await statFile(email.fileUrl);
    if (!stat) {
      await release();
      return { ok: false, reason: "The email file is missing from storage." };
    }
    if (stat.size > EMAIL_MAX_BYTES) {
      await release();
      return { ok: false, reason: "This email is too large to extract attachments from — download it instead." };
    }
    const read = await readStoredBytes(email.fileUrl, EMAIL_MAX_BYTES, stat);
    if (!read) {
      await release();
      return { ok: false, reason: "The email file is missing from storage." };
    }
    const files = (await readEmailFiles(read.buffer, kind)).slice(0, MAX_EXTRACTED_ATTACHMENTS);

    const rows: {
      name: string;
      index: number;
      key: string;
      size: number;
      contentType: string;
    }[] = [];
    for (const [index, f] of files.entries()) {
      if (f.content.byteLength === 0) continue;
      const name = capDocumentName(f.name);
      // Same server-side MIME rule as uploads (never the email's claim).
      const contentType = contentTypeForFilename(name);
      const saved = await storeFile(new File([new Uint8Array(f.content)], name, { type: contentType }));
      stored.push(saved.key);
      rows.push({ name, index, key: saved.key, size: saved.size, contentType });
    }

    await prisma.$transaction(
      rows.map((r) =>
        prisma.document.create({
          data: {
            matterId: email.matterId,
            folderId: email.folderId,
            parentDocumentId: email.id,
            attachmentIndex: r.index,
            name: r.name,
            category: email.category,
            source: "email_attachment",
            fileUrl: r.key,
            contentType: r.contentType,
            fileSize: r.size,
            uploadedBy: actorId,
          },
          select: { id: true },
        })
      )
    );

    if (rows.length > 0) {
      await logActivity({
        matterId: email.matterId,
        userId: actorId,
        type: "document",
        title: rows.length === 1 ? "Email attachment added" : `${rows.length} email attachments added`,
        detail: `From ${email.name}: ${rows.map((r) => r.name).join(", ").slice(0, 300)}`,
      });
    }
    return { ok: true, created: rows.length };
  } catch (err) {
    console.error("[email-attachments] extraction failed", {
      documentId,
      message: err instanceof Error ? err.message : String(err),
    });
    await Promise.all(stored.map((k) => deleteFile(k).catch(() => undefined)));
    await release().catch(() => undefined);
    return { ok: false, reason: "The attachments couldn't be extracted. The email may be corrupt." };
  }
}

/** Best-effort hook for the upload paths: extract when the new
 *  document is an email; never throws (the upload already succeeded). */
export async function extractIfEmail(
  doc: { id: string; contentType: string | null; name: string },
  actorId: string
): Promise<void> {
  try {
    if (!emailKindOf(doc.contentType, doc.name)) return;
    await extractEmailAttachments(doc.id, actorId);
  } catch (err) {
    console.error("[email-attachments] post-upload extraction threw", err);
  }
}
