/**
 * Portal client-direct blob upload: the `handleUpload` callbacks (split out
 * of route.ts so they are testable; Next restricts route-file exports).
 *
 * Same three-step flow as the staff uploader (src/app/api/documents/upload/
 * blob/blob-upload.ts), with the portal's rules:
 *   1. Token (`onBeforeGenerateToken`): the request carries the portal
 *      cookie. Everything is checked here: portal identity, live access to
 *      the matter, the request (open, or already submitted by this batch),
 *      the type allowlist, and the daily cap. The token pins the content
 *      type and size.
 *   2. The browser PUTs the bytes straight to Vercel Blob.
 *   3. Completion (`onUploadCompleted`) is a webhook from Vercel, signature-
 *      verified by `handleUpload`. It has NO portal cookie: identity comes
 *      only from the signed `tokenPayload` written in step 1, and
 *      `recordPortalUpload` re-checks identity, portal switch and access.
 *
 * Callback URL: this handler runs at the rewritten internal path
 * `/portal/api/documents/upload/blob`. The SDK's default callback is
 * VERCEL_PROJECT_PRODUCTION_URL (the staff host) + that path, which 404s
 * (staff host refuses /portal/*); the staff route at the public path would
 * also be wrong. So the token names the public portal URL explicitly, and
 * the proxy rewrites it back here.
 */

import { del, head } from "@vercel/blob";
import type { HandleUploadOptions } from "@vercel/blob/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getPortalIdentity } from "@/lib/portal-access";
import { portalHomeUrl } from "@/lib/portal/link-url";
import { checkPortalUpload } from "@/lib/portal/upload-policy";
import {
  PORTAL_UPLOAD_NOTE_MAX,
  checkPortalUploadTarget,
  recordPortalUpload,
} from "@/lib/portal/record-upload";
import { isValidStorageKey } from "@/lib/storage/storage-key";
import { BLOB_CACHE_MAX_AGE_SECONDS } from "@/lib/storage/blob-driver";
import {
  MAX_DOCUMENT_NAME_LENGTH,
  isMediaType,
} from "@/app/api/documents/upload/upload-config";

/** Public path of this route on the portal host. */
export const PORTAL_UPLOAD_CALLBACK_PATH = "/api/documents/upload/blob";

/** User-safe message + HTTP status for route.ts. */
export class PortalUploadError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "PortalUploadError";
    this.status = status;
  }
}

/** The completion webhook target, or null when PORTAL_HOST is unset (a
 *  dev host has no public URL; dev uses the multipart route). */
export function portalUploadCallbackUrl(): string | null {
  if (!process.env.PORTAL_HOST?.trim()) return null;
  return `${portalHomeUrl()}${PORTAL_UPLOAD_CALLBACK_PATH}`;
}

const TOKEN_TTL_MS = 60 * 60 * 1000;
const MEDIA_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

const clientPayloadSchema = z.object({
  matterId: z.string().min(1),
  requestId: z.string().min(1).nullish(),
  batchId: z.string().uuid(),
  name: z.string().trim().min(1).max(MAX_DOCUMENT_NAME_LENGTH),
  note: z.string().max(PORTAL_UPLOAD_NOTE_MAX).nullish(),
});

const tokenPayloadSchema = z.object({
  kind: z.literal("portal"),
  identityId: z.string().min(1),
  matterId: z.string().min(1),
  requestId: z.string().min(1).nullable(),
  batchId: z.string().uuid(),
  name: z.string().min(1),
  note: z.string().nullable(),
  contentType: z.string().min(1),
});
type TokenPayload = z.infer<typeof tokenPayloadSchema>;

export const onBeforeGenerateToken: HandleUploadOptions["onBeforeGenerateToken"] =
  async (pathname, clientPayload) => {
    const identity = await getPortalIdentity();
    if (!identity) throw new PortalUploadError(401, "Please sign in again.");

    if (!isValidStorageKey(pathname)) {
      throw new PortalUploadError(400, "Invalid upload pathname.");
    }
    let payload: z.infer<typeof clientPayloadSchema>;
    try {
      payload = clientPayloadSchema.parse(JSON.parse(clientPayload ?? ""));
    } catch {
      throw new PortalUploadError(400, "Invalid upload payload.");
    }

    // The key's extension decides the stored type; the display name must
    // agree so a ".exe" can't hide behind a ".pdf" key.
    const policy = checkPortalUpload(pathname);
    if (!policy.ok) throw new PortalUploadError(400, policy.error);
    const named = checkPortalUpload(payload.name);
    if (!named.ok) throw new PortalUploadError(400, named.error);
    if (named.contentType !== policy.contentType) {
      throw new PortalUploadError(400, "Invalid upload payload.");
    }

    const requestId = payload.requestId ?? null;
    const target = await checkPortalUploadTarget({
      identityId: identity.identityId,
      matterId: payload.matterId,
      requestId,
      batchId: payload.batchId,
    });
    if (!target.ok) throw new PortalUploadError(target.status, target.error);

    const callbackUrl = portalUploadCallbackUrl();
    if (!callbackUrl) {
      throw new PortalUploadError(503, "Uploads aren't available right now.");
    }

    const tokenPayload: TokenPayload = {
      kind: "portal",
      identityId: identity.identityId,
      matterId: payload.matterId,
      requestId,
      batchId: payload.batchId,
      name: payload.name,
      note: payload.note?.trim() || null,
      contentType: policy.contentType,
    };
    return {
      allowedContentTypes: [policy.contentType],
      maximumSizeInBytes: policy.maxBytes,
      validUntil: Date.now() + (isMediaType(policy.contentType) ? MEDIA_TOKEN_TTL_MS : TOKEN_TTL_MS),
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: BLOB_CACHE_MAX_AGE_SECONDS,
      tokenPayload: JSON.stringify(tokenPayload),
      callbackUrl,
    };
  };

/**
 * Delivered at least once; retried on any throw. A refusal that a retry
 * can't fix (access revoked, portal off, type) deletes the blob and
 * returns normally. A payload we didn't write throws: we never guess an
 * identity.
 */
export const onUploadCompleted: NonNullable<HandleUploadOptions["onUploadCompleted"]> =
  async ({ blob, tokenPayload }) => {
    if (!tokenPayload) throw new Error("Missing token payload on completed upload.");
    const t = tokenPayloadSchema.parse(JSON.parse(tokenPayload));

    // Redelivery: skip the size probe; recordPortalUpload no-ops too.
    const existing = await prisma.document.findFirst({
      where: { fileUrl: blob.url },
      select: { id: true },
    });
    if (existing) return;

    const meta = await head(blob.url);
    if (meta.size === 0) {
      await del(blob.url).catch(() => {});
      return;
    }

    // The stored key's type must still pass (it did at token time).
    const keyPolicy = checkPortalUpload(blob.pathname);
    const result = await recordPortalUpload({
      identityId: t.identityId,
      matterId: t.matterId,
      requestId: t.requestId,
      batchId: t.batchId,
      storageKey: blob.url,
      filename: keyPolicy.ok ? t.name : blob.pathname,
      contentType: t.contentType,
      size: meta.size,
      note: t.note,
    });
    if (!result.ok) {
      console.error("[portal-blob-upload] upload refused at completion; blob removed", {
        matterId: t.matterId,
        error: result.error,
      });
    }
  };
