/**
 * Vercel Blob storage driver — PRIVATE store (ADR-018).
 *
 * Active in production (Vercel's serverless filesystem is
 * ephemeral, so the local driver can't hold user files there).
 * Server-side writes here cover SMALL files only — generated
 * templates, the ≤25MB composer form — because anything routed
 * through a Vercel function body is capped at ~4.5MB in prod.
 * GB-scale uploads bypass this module entirely and go client-direct
 * via `@vercel/blob/client` (`src/app/api/documents/upload/blob/`).
 *
 * Private means a blob URL is NOT a bearer credential: fetching it
 * needs the store token. So:
 *   - Serving: the download route asks `signedBlobUrl` for a
 *     short-lived presigned GET URL scoped to that one pathname and
 *     302s the browser there (the CDN still does Range/seeking).
 *   - Server-side reads (docx/text previews, filing an email
 *     attachment to a matter): `readBlobBytes`, an authenticated
 *     `get()`.
 *
 * key↔URL mapping (storage-key.ts + ADR-015): we `put` under a
 * pathname in the shared `{rand}__{name}` key scheme; the value we
 * hand back as `key` — what lands in `Document.fileUrl` — is the
 * blob's full URL (`https://<store>.private.blob.vercel-storage.com/
 * {key}`). `del`/`head`/`get` accept it directly; presigning needs
 * the pathname, which `blobPathname` recovers from it.
 */

import {
  BlobNotFoundError,
  del,
  get,
  head,
  issueSignedToken,
  presignUrl,
  put,
} from "@vercel/blob";
import { makeStorageKey } from "./storage-key";
import type { StoredFile } from "./local-driver";

/** Every write and read goes to the private store. */
export const BLOB_ACCESS = "private" as const;

/**
 * Edge cache TTL for blob content, in seconds. The SDK default is
 * one MONTH; deleting a blob doesn't purge cached copies, so keep
 * it short. One hour keeps media seeking cheap while bounding the
 * post-delete window. Shared with the client-upload token route so
 * both write paths behave identically.
 */
export const BLOB_CACHE_MAX_AGE_SECONDS = 60 * 60;

/**
 * Presigned-URL lifetimes. A browser keeps re-using the redirect
 * target for every Range request while a video plays and seeks, so
 * media gets long enough for a multi-hour bodycam/deposition
 * recording; everything else is minutes. Either way the URL is only
 * minted after the download route's session check.
 */
export const SIGNED_URL_TTL_MS = 15 * 60 * 1000;
export const SIGNED_MEDIA_URL_TTL_MS = 6 * 60 * 60 * 1000;

/** Server-side `put` — small files only (see module docstring). */
export async function storeFileBlob(file: File): Promise<StoredFile> {
  const contentType = file.type || "application/octet-stream";
  const blob = await put(makeStorageKey(file.name), file, {
    access: BLOB_ACCESS,
    contentType,
    // Our key already carries 16 chars of entropy; a second random
    // suffix would just diverge the pathname from the key scheme.
    addRandomSuffix: false,
    // Default (false) made explicit: a colliding key must fail loudly,
    // never silently replace someone's file.
    allowOverwrite: false,
    cacheControlMaxAge: BLOB_CACHE_MAX_AGE_SECONDS,
  });
  // The FULL URL is the key from here on out (Document.fileUrl).
  return { key: blob.url, size: file.size, contentType };
}

/** Best-effort delete — mirrors the local driver's contract.
 *  `del` is a no-op for already-gone blobs, but guard anyway so a
 *  missing file can never outrank the DB delete. */
export async function deleteFileBlob(url: string): Promise<void> {
  try {
    await del(url);
  } catch (err) {
    if (!(err instanceof BlobNotFoundError)) throw err;
  }
}

/** Existence + size probe. `head` throws on a missing blob; the
 *  facade contract is `null` for "gone" (the download route maps
 *  that to 410). */
export async function statFileBlob(
  url: string
): Promise<{ size: number } | null> {
  try {
    const meta = await head(url);
    return { size: meta.size };
  } catch (err) {
    if (err instanceof BlobNotFoundError) return null;
    throw err;
  }
}

/** Pathname of a stored blob URL (what signing is scoped to). */
export function blobPathname(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

/**
 * Short-lived presigned GET URL for one stored blob. `download`
 * appends the CDN's `download=1` (Content-Disposition: attachment);
 * like the SDK's own `cache=0`, it's outside the signed payload, so
 * adding it doesn't invalidate the signature.
 */
export async function signedBlobUrl(
  url: string,
  opts: { download?: boolean; media?: boolean } = {}
): Promise<string> {
  const pathname = blobPathname(url);
  const validUntil =
    Date.now() + (opts.media ? SIGNED_MEDIA_URL_TTL_MS : SIGNED_URL_TTL_MS);
  const token = await issueSignedToken({
    pathname,
    operations: ["get"],
    validUntil,
  });
  const { presignedUrl } = await presignUrl(token, {
    operation: "get",
    pathname,
    validUntil,
    access: BLOB_ACCESS,
  });
  if (!opts.download) return presignedUrl;
  const signed = new URL(presignedUrl);
  signed.searchParams.set("download", "1");
  return signed.toString();
}

/**
 * Authenticated server-side read, bounded by `maxBytes` (a ranged
 * request, so bytes past the cap are never transferred). `null` when
 * the blob is gone. For previews/attachment copies — never point it
 * at GB-scale media.
 */
export async function readBlobBytes(
  url: string,
  maxBytes?: number
): Promise<Buffer | null> {
  const result = await get(url, {
    access: BLOB_ACCESS,
    ...(maxBytes !== undefined
      ? { headers: { range: `bytes=0-${maxBytes - 1}` } }
      : {}),
  });
  if (!result || result.statusCode !== 200) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = result.stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    // Belt-and-braces if the CDN ignored the Range header.
    if (maxBytes !== undefined && total >= maxBytes) {
      await reader.cancel();
      break;
    }
  }
  const buffer = Buffer.concat(chunks);
  return maxBytes !== undefined ? buffer.subarray(0, maxBytes) : buffer;
}
