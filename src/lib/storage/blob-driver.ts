/**
 * Vercel Blob storage driver — bytes at
 * `https://<store>.public.blob.vercel-storage.com/{key}`.
 *
 * Active in production (Vercel's serverless filesystem is
 * ephemeral, so the local driver can't hold user files there).
 * Server-side writes here cover SMALL files only — generated
 * templates, the ≤25MB composer form — because anything routed
 * through a Vercel function body is capped at ~4.5MB in prod.
 * GB-scale uploads bypass this module entirely and go client-direct
 * via `@vercel/blob/client` (`src/app/api/documents/upload/blob/`).
 *
 * key↔URL mapping (documented in full in storage-key.ts + ADR-015):
 * we `put` under a pathname in the shared `{rand}__{name}` key
 * scheme, but the value we hand back as `key` — and thus what lands
 * in `Document.fileUrl` — is the blob's full public URL. `del` and
 * `head` accept that URL directly, and the download route 302s to
 * it, so no reverse mapping is ever needed.
 *
 * What @vercel/blob does NOT let us set (verified against v2.6.0):
 * a custom Content-Disposition at upload. The CDN derives the
 * disposition (inline, filename from the pathname suffix); the only
 * lever is the `?download=1` query param (`getDownloadUrl`), which
 * flips the SAME blob to `attachment` at serve time. The download
 * route uses that for types we don't want rendering in-tab.
 */

import { BlobNotFoundError, del, getDownloadUrl, head, put } from "@vercel/blob";
import { makeStorageKey } from "./storage-key";
import type { StoredFile } from "./local-driver";

/**
 * Edge/browser cache TTL for blob content, in seconds. The SDK
 * default is one MONTH — far too long for legal documents, because
 * deleting a blob does not purge already-cached CDN copies: a
 * leaked URL could keep serving for the full TTL after deletion.
 * One hour keeps media seeking cheap (the CDN serves Range
 * requests from cache) while bounding the post-delete exposure
 * window. Shared with the client-upload token route so both write
 * paths behave identically.
 */
export const BLOB_CACHE_MAX_AGE_SECONDS = 60 * 60;

/** Server-side `put` — small files only (see module docstring). */
export async function storeFileBlob(file: File): Promise<StoredFile> {
  const contentType = file.type || "application/octet-stream";
  const blob = await put(makeStorageKey(file.name), file, {
    access: "public",
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

/** `?download=1` variant of a blob URL — forces the CDN to serve
 *  `Content-Disposition: attachment`. The redirect-time equivalent
 *  of the local driver's attachment forcing. */
export function blobDownloadUrl(url: string): string {
  return getDownloadUrl(url);
}
