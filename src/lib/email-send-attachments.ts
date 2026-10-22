/**
 * Attachments for app-sent email. Server-only.
 *
 * An attachment is a Document already filed to the email's matter or
 * lead: the composer posts document ids, never bytes (ADR-034), and
 * the bytes are read back out of storage here. Callers have already
 * passed `assertScopeAccess(scope)`; this module only ever reads
 * documents inside that scope, so an id from another record (or a
 * walled one) simply doesn't resolve.
 */

import { prisma } from "@/lib/prisma";
import { scopeWhere, type RecordScope } from "@/lib/record-scope";
import { readStoredBytes } from "@/lib/email-attachments";
import { contentTypeForFilename } from "@/app/api/documents/upload/upload-config";
import { MAX_SEND_ATTACHMENTS, MAX_SEND_ATTACHMENT_BYTES } from "@/lib/email-send-status";
import type { MimeAttachment } from "@/lib/google/mime";

export type SendAttachment = MimeAttachment & {
  documentId: string;
  /** The document's stored-file key, recorded on the sent message's
   *  attachment row so the reader can serve it. */
  fileUrl: string;
  size: number;
};

const TOO_LARGE_ERROR = `Attachments are too large to send (max ${Math.round(
  MAX_SEND_ATTACHMENT_BYTES / (1024 * 1024),
)} MB in total).`;

export async function loadSendAttachments(
  scope: RecordScope,
  documentIds: string[] | undefined,
): Promise<{ ok: true; attachments: SendAttachment[] } | { ok: false; error: string }> {
  const ids = [...new Set(documentIds ?? [])];
  if (ids.length === 0) return { ok: true, attachments: [] };
  if (ids.length > MAX_SEND_ATTACHMENTS) {
    return {
      ok: false,
      error: `Too many attachments (max ${MAX_SEND_ATTACHMENTS}).`,
    };
  }

  const docs = await prisma.document.findMany({
    where: { id: { in: ids }, ...scopeWhere(scope) },
    select: {
      id: true,
      name: true,
      fileUrl: true,
      contentType: true,
      fileSize: true,
    },
  });
  const byId = new Map(docs.map((d) => [d.id, d]));
  const label = scope.kind === "matter" ? "matter" : "lead";
  for (const id of ids) {
    const doc = byId.get(id);
    if (!doc) {
      return {
        ok: false,
        error: `An attachment is no longer in this ${label}'s documents. Remove it and try again.`,
      };
    }
    if (!doc.fileUrl) {
      return { ok: false, error: `"${doc.name}" has no file to attach.` };
    }
  }

  // Cheap pre-check on recorded sizes before reading any bytes.
  const recorded = docs.reduce((n, d) => n + (d.fileSize ?? 0), 0);
  if (recorded > MAX_SEND_ATTACHMENT_BYTES) {
    return { ok: false, error: TOO_LARGE_ERROR };
  }

  const attachments: SendAttachment[] = [];
  let total = 0;
  // In the order the user attached them.
  for (const id of ids) {
    const doc = byId.get(id)!;
    let bytes: Buffer;
    try {
      bytes = await readStoredBytes(doc.fileUrl!);
    } catch (err) {
      console.error("[email-send] attachment bytes unreadable", doc.id, err);
      return { ok: false, error: `Couldn't read "${doc.name}" from storage.` };
    }
    total += bytes.length;
    if (total > MAX_SEND_ATTACHMENT_BYTES) {
      return { ok: false, error: TOO_LARGE_ERROR };
    }
    const filename = attachmentFilename(doc.name, doc.fileUrl!);
    attachments.push({
      documentId: doc.id,
      fileUrl: doc.fileUrl!,
      filename,
      contentType: doc.contentType || contentTypeForFilename(filename),
      base64: bytes.toString("base64"),
      size: bytes.length,
    });
  }
  return { ok: true, attachments };
}

/** The name a recipient sees. A document's name is a display name and
 *  may have lost its extension in a rename ("Signed retainer"); borrow
 *  it from the storage key (`<id>__<original name>`), so mail clients
 *  can still open the file. */
export function attachmentFilename(name: string, fileUrl: string): string {
  if (/\.[A-Za-z0-9]{1,10}$/.test(name)) return name;
  const base = fileUrl.split("?")[0].split("/").pop() ?? "";
  const ext = /\.([A-Za-z0-9]{1,10})$/.exec(base)?.[1];
  return ext ? `${name}.${ext}` : name;
}
