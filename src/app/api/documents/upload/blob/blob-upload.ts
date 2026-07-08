/**
 * Client-direct blob upload — the `handleUpload` callbacks, split
 * out of route.ts so they're unit-testable (Next restricts route
 * files to route exports; same pattern as ../upload-config.ts).
 *
 * Flow (@vercel/blob/client):
 *   1. Browser asks THIS route for a scoped one-time client token
 *      (`blob.generate-client-token` event → `onBeforeGenerateToken`).
 *      All authorization happens HERE — session, `documents.upload`
 *      permission, matter/folder validation — because step 3 has no
 *      user session to check.
 *   2. Browser PUTs the file straight to Vercel Blob with that
 *      token. The bytes never touch our serverless functions, which
 *      is the whole point: prod request bodies cap at ~4.5MB, and
 *      discovery media runs to gigabytes.
 *   3. Vercel Blob calls THIS route back (`blob.upload-completed`,
 *      signature-verified by `handleUpload`) → `onUploadCompleted`
 *      creates the Document row + audit entry. Identity comes from
 *      `tokenPayload`, which WE wrote in step 1 — the client never
 *      supplies it.
 *
 * IMPORTANT — why the streaming route (../route.ts) still exists:
 * step 3 arrives over the PUBLIC INTERNET from Vercel's
 * infrastructure. On localhost there is no public URL to call back,
 * so `onUploadCompleted` never fires and no Document row would ever
 * be created. Local dev therefore stays on the `local` storage
 * driver + the busboy streaming route; this path is production-only
 * by construction. (Testing it locally requires a tunnel, e.g.
 * `ngrok` + VERCEL_BLOB_CALLBACK_URL.)
 *
 * Auth gate uses `currentUserHasPermission`, not `requirePermission`
 * — the latter `redirect()`s, the wrong shape for a JSON API.
 *
 * MIME rule matches the streaming route: server-derived from the
 * pathname's extension (`contentTypeForFilename`); the token's
 * `allowedContentTypes` pins the upload to exactly that type, and
 * the uploader derives its declared type from the same shared
 * function, so the two can never disagree.
 */

import { revalidatePath } from "next/cache";
import { del, head } from "@vercel/blob";
import type { HandleUploadOptions } from "@vercel/blob/client";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { currentUserHasPermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import { isValidStorageKey } from "@/lib/storage/storage-key";
import { BLOB_CACHE_MAX_AGE_SECONDS } from "@/lib/storage/blob-driver";
import {
  MAX_MEDIA_UPLOAD_BYTES,
  MAX_STANDARD_UPLOAD_BYTES,
  contentTypeForFilename,
  isMediaType,
} from "../upload-config";

/** Carries an HTTP status so route.ts can answer 401/403/404
 *  instead of a blanket 400 when a callback rejects. */
export class UploadTokenError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "UploadTokenError";
    this.status = status;
  }
}

/** What the browser sends alongside the token request. Same target
 *  contract as the streaming route's form fields. */
const clientPayloadSchema = z.object({
  matterId: z.string().min(1),
  folderId: z.string().min(1).nullish(),
  /** Original filename — the Document display name. The pathname
   *  is the sanitized/truncated KEY; this preserves what the user
   *  actually called the file. */
  name: z.string().min(1).max(255),
});

/** Round-trips from token generation to the completion callback —
 *  signed into the client token by `handleUpload`, so the uploader
 *  can't tamper with it. */
type TokenPayload = {
  matterId: string;
  folderId: string | null;
  name: string;
  contentType: string;
  userId: string;
};

export const onBeforeGenerateToken: HandleUploadOptions["onBeforeGenerateToken"] =
  async (pathname, clientPayload) => {
    const session = await auth();
    if (!session?.user?.id) {
      throw new UploadTokenError(401, "Unauthorized");
    }
    const allowed = await currentUserHasPermission("documents.upload");
    if (!allowed) {
      throw new UploadTokenError(
        403,
        "You don't have permission to upload documents."
      );
    }

    // The client proposes its own pathname (it generates the key
    // before asking us) — accept only our `{rand16}__{name}` shape.
    // Anything else could nest "folders" or collide on purpose;
    // `allowOverwrite: false` below is the backstop either way.
    if (!isValidStorageKey(pathname)) {
      throw new UploadTokenError(400, "Invalid upload pathname.");
    }

    let payload: z.infer<typeof clientPayloadSchema>;
    try {
      payload = clientPayloadSchema.parse(JSON.parse(clientPayload ?? ""));
    } catch {
      throw new UploadTokenError(400, "Invalid upload payload.");
    }

    // Same target validation as the streaming route's resolveTarget.
    // TODO (multi-tenant): scope by firmId once Matter carries one.
    const matter = await prisma.matter.findUnique({
      where: { id: payload.matterId },
      select: { id: true },
    });
    if (!matter) throw new UploadTokenError(404, "Matter not found.");

    const folderId = payload.folderId ?? null;
    if (folderId) {
      // Scoped find — a folderId from a *different* matter must not
      // let files leak into that matter's tree.
      const folder = await prisma.documentFolder.findFirst({
        where: { id: folderId, matterId: payload.matterId },
        select: { id: true },
      });
      if (!folder) {
        throw new UploadTokenError(400, "Folder not found in this matter.");
      }
    }

    // Server-derived MIME from the key's extension — the same rule
    // (and the same function) as the streaming route. The token pins
    // the upload to exactly this type + this size cap; a client
    // declaring anything else is rejected by Vercel Blob itself.
    const contentType = contentTypeForFilename(pathname);
    const maximumSizeInBytes = isMediaType(contentType)
      ? MAX_MEDIA_UPLOAD_BYTES
      : MAX_STANDARD_UPLOAD_BYTES;

    const tokenPayload: TokenPayload = {
      matterId: payload.matterId,
      folderId,
      name: payload.name,
      contentType,
      userId: session.user.id,
    };

    return {
      allowedContentTypes: [contentType],
      maximumSizeInBytes,
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: BLOB_CACHE_MAX_AGE_SECONDS,
      tokenPayload: JSON.stringify(tokenPayload),
    };
  };

export const onUploadCompleted: NonNullable<
  HandleUploadOptions["onUploadCompleted"]
> = async ({ blob, tokenPayload }) => {
  if (!tokenPayload) {
    throw new Error("Missing token payload on completed upload.");
  }
  // Trusted: we serialized it in onBeforeGenerateToken and
  // handleUpload verified the callback signature.
  const t = JSON.parse(tokenPayload) as TokenPayload;

  // `blob` carries no size — probe for it (also confirms the bytes
  // actually landed before we write a row pointing at them).
  const meta = await head(blob.url);
  if (meta.size === 0) {
    // Parity with the streaming route: empty files never get rows.
    // Delete the empty blob and swallow — throwing would make
    // Vercel retry a callback that can never succeed.
    await del(blob.url).catch(() => {});
    return;
  }

  await prisma.document.create({
    data: {
      matterId: t.matterId,
      folderId: t.folderId,
      name: t.name,
      // Same default as the streaming route — this path exists for
      // discovery productions; re-categorizing is a documents-tab edit.
      category: "discovery",
      source: "upload",
      // Full blob URL — the key under the vercel-blob driver
      // (storage-key.ts documents the mapping).
      fileUrl: blob.url,
      contentType: t.contentType,
      fileSize: meta.size,
      uploadedBy: t.userId,
    },
  });

  // One activity row PER FILE — unlike the streaming route's
  // one-per-batch, because each client upload completes via its own
  // independent callback; there is no server-side batch to group.
  // Known trade-off (ADR-015): a 40-file production writes 40 rows.
  await logActivity({
    matterId: t.matterId,
    userId: t.userId,
    type: "document",
    title: "Document uploaded",
    detail: t.name.slice(0, 500),
  });

  revalidatePath(`/matters/${t.matterId}/documents`);
  revalidatePath(`/matters/${t.matterId}`);
};
