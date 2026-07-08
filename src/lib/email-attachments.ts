/**
 * Email-attachment bytes — fetch-on-demand + cache. Server-only.
 *
 * The Gmail sync engine stores EmailAttachment rows METADATA-ONLY:
 * `fileUrl` holds the parking convention `gmail:<attachmentId>`
 * until someone actually wants the bytes (see gmail-sync.ts — the
 * parked id survives resyncs; a cached storage key is never
 * clobbered). This module is the other half of that contract:
 *
 *   `ensureAttachmentBytes(attachmentId)` — returns the storage key
 *       for the attachment's bytes, fetching them from Gmail
 *       (`users/me/messages/{mid}/attachments/{aid}`, base64url
 *       payload) and caching via `storeFile` on FIRST use. The
 *       parked→cached transition is guarded by a conditional
 *       `updateMany({ where: { fileUrl: <parked> } })`, so two
 *       concurrent first-downloads converge on ONE stored copy (the
 *       loser deletes its bytes and adopts the winner's key).
 *
 *   `readStoredBytes(key)` — buffer a stored file back out of either
 *       driver (local stream / blob URL fetch). Used by the
 *       file-to-matter action to COPY attachment bytes into an
 *       independent Document key — Document delete unlinks its
 *       `fileUrl`, so a Document must never share a storage key with
 *       the EmailAttachment (or with another filing of it).
 *
 * SCOPING IS THE CALLER'S JOB. This module resolves rows by id
 * without any user check — the download route and the filing action
 * both verify mailbox ownership (`account.userId`, matching the
 * `getThreadById` read model) before calling in.
 *
 * Failure vocabulary (`AttachmentBytesError.code`):
 *   - "no_bytes"     — sync never captured a Gmail attachmentId (or
 *                      the message has no externalId): nothing to
 *                      fetch, ever.
 *   - "disconnected" — the mailbox's Google grant is gone
 *                      (GmailAuthError). Uncached bytes are
 *                      unreachable until the owner reconnects — the
 *                      route maps this to 409 + a reconnect message.
 *   - "fetch_failed" — Gmail answered non-OK / unparseable payload.
 *                      Transient; retry later.
 */

import { prisma } from "@/lib/prisma";
import { GmailAuthError, gmailFetch } from "@/lib/google/gmail-client";
import {
  deleteFile,
  isBlobKey,
  openReadStream,
  storeFile,
} from "@/lib/file-storage";
import { contentTypeForFilename } from "@/app/api/documents/upload/upload-config";

/** `fileUrl` prefix the sync engine parks Gmail attachment ids
 *  under. Everything else in the column is a real storage key. */
export const GMAIL_PARKED_PREFIX = "gmail:";

export function isParkedGmailKey(fileUrl: string | null): fileUrl is string {
  return fileUrl !== null && fileUrl.startsWith(GMAIL_PARKED_PREFIX);
}

export type AttachmentBytesFailure =
  | "no_bytes"
  | "disconnected"
  | "fetch_failed";

export class AttachmentBytesError extends Error {
  constructor(
    readonly code: AttachmentBytesFailure,
    message: string
  ) {
    super(message);
    this.name = "AttachmentBytesError";
  }
}

const RECONNECT_MESSAGE =
  "This mailbox is no longer connected to Google, so the attachment can't be fetched. Reconnect it from Settings → Integrations, then try again.";

/**
 * Ensure the attachment's bytes are in storage; returns the storage
 * key. Cached rows return immediately with ZERO Gmail calls; parked
 * rows fetch once, store, and flip `fileUrl` (also backfilling
 * `fileSize` with the true byte count).
 *
 * Throws `AttachmentBytesError` (see module docstring) or plain
 * Error when the attachment row itself is missing — callers resolve
 * + scope the row first, so that's a programming error, not a user
 * state.
 */
export async function ensureAttachmentBytes(
  attachmentId: string
): Promise<{ key: string }> {
  const attachment = await prisma.emailAttachment.findUnique({
    where: { id: attachmentId },
    select: {
      id: true,
      filename: true,
      fileUrl: true,
      message: {
        select: {
          externalId: true,
          thread: { select: { accountId: true } },
        },
      },
    },
  });
  if (!attachment) {
    throw new Error(`EmailAttachment ${attachmentId} not found.`);
  }

  const parked = attachment.fileUrl;
  if (parked !== null && !isParkedGmailKey(parked)) {
    // Already cached — serve like any stored file.
    return { key: parked };
  }
  if (parked === null || !attachment.message.externalId) {
    throw new AttachmentBytesError(
      "no_bytes",
      "This attachment has no downloadable content on record."
    );
  }

  const gmailAttachmentId = parked.slice(GMAIL_PARKED_PREFIX.length);
  const accountId = attachment.message.thread.accountId;

  let res: Response;
  try {
    res = await gmailFetch(
      accountId,
      `/users/me/messages/${encodeURIComponent(
        attachment.message.externalId
      )}/attachments/${encodeURIComponent(gmailAttachmentId)}`
    );
  } catch (err) {
    if (err instanceof GmailAuthError) {
      throw new AttachmentBytesError("disconnected", RECONNECT_MESSAGE);
    }
    throw err;
  }
  if (!res.ok) {
    throw new AttachmentBytesError(
      "fetch_failed",
      `Gmail returned ${res.status} while fetching the attachment.`
    );
  }

  // MessagePartBody: `data` is base64url. `size` is Gmail's claim;
  // we persist the decoded length instead.
  const body = (await res.json()) as { data?: unknown };
  if (typeof body.data !== "string" || body.data.length === 0) {
    throw new AttachmentBytesError(
      "fetch_failed",
      "Gmail returned an empty attachment payload."
    );
  }
  const bytes = Buffer.from(body.data, "base64url");

  // Content type for storage comes from a server-side extension
  // re-derivation, NOT the sender-declared EmailAttachment
  // contentType — same trust stance as the upload route.
  const stored = await storeFile(
    new File([new Uint8Array(bytes)], attachment.filename, {
      type: contentTypeForFilename(attachment.filename),
    })
  );

  // Exactly-once transition: only flip fileUrl if it's STILL the
  // parked value. A concurrent request may have cached first — then
  // our copy is a duplicate: drop it and adopt theirs.
  const flipped = await prisma.emailAttachment.updateMany({
    where: { id: attachment.id, fileUrl: parked },
    data: { fileUrl: stored.key, fileSize: stored.size },
  });
  if (flipped.count === 0) {
    await deleteFile(stored.key);
    const winner = await prisma.emailAttachment.findUnique({
      where: { id: attachment.id },
      select: { fileUrl: true },
    });
    if (winner?.fileUrl && !isParkedGmailKey(winner.fileUrl)) {
      return { key: winner.fileUrl };
    }
    // Row vanished / reverted mid-flight — treat as transient.
    throw new AttachmentBytesError(
      "fetch_failed",
      "The attachment changed while downloading — try again."
    );
  }
  return { key: stored.key };
}

/** Buffer a stored file's bytes back out, whichever driver holds
 *  them. Attachment-scale only (Gmail caps ~25MB) — never point
 *  this at GB-scale discovery media. */
export async function readStoredBytes(key: string): Promise<Buffer> {
  if (isBlobKey(key)) {
    const res = await fetch(key);
    if (!res.ok) {
      throw new Error(`Blob fetch failed with ${res.status} for stored file.`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
  const chunks: Buffer[] = [];
  for await (const chunk of openReadStream(key)) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
