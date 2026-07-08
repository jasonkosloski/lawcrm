/**
 * File storage facade — server-only.
 *
 * The thin layer between server actions / routes and wherever bytes
 * actually live. Two drivers (ADR-015):
 *
 *   - `local`        ./uploads/{key} on disk. Dev default; what the
 *                    test suite runs against. Ephemeral on Vercel,
 *                    so never the prod driver there.
 *   - `vercel-blob`  Vercel Blob via @vercel/blob. Active whenever
 *                    BLOB_READ_WRITE_TOKEN is set (an explicit
 *                    STORAGE_DRIVER env var wins over detection —
 *                    e.g. STORAGE_DRIVER=local keeps dev on disk
 *                    even after `vercel env pull` drops the token
 *                    into .env).
 *
 * Dispatch rules — WRITES pick by active driver, READS/DELETES pick
 * by key shape:
 *
 *   Blob-stored keys are full https:// URLs (see storage-key.ts for
 *   the mapping); local keys are bare `{rand}__{name}` strings. So
 *   `deleteFile` / `statFile` route on `isBlobKey(key)` rather than
 *   on the active driver — after a driver switch, documents written
 *   under the OLD driver still delete/stat/serve correctly instead
 *   of being stranded.
 *
 * Driver capability gaps are loud, not silent:
 *   - `storeStream` is local-only. Under the blob driver, GB-scale
 *     uploads must go client-direct (browser → Vercel Blob) because
 *     prod serverless bodies cap at ~4.5MB — a server-side stream
 *     write would be lying about what production can do. The
 *     streaming route guards on the driver before calling this.
 *   - `openReadStream` refuses blob keys — the download route 302s
 *     to the blob URL instead of proxying bytes.
 *
 * Storage is NOT public under the local driver — files are served
 * only via `/api/documents/[id]/download`, which gates by session.
 * Under the blob driver, blob URLs are unguessable-but-public bearer
 * URLs on an isolated origin; the download route still gates who is
 * ever HANDED a URL. Trade-offs recorded honestly in ADR-015.
 */

import type { Readable } from "node:stream";
import {
  FileTooLargeError,
  deleteFileLocal,
  openReadStreamLocal,
  statFileLocal,
  storeFileLocal,
  storeStreamLocal,
  type StoredFile,
} from "./storage/local-driver";
import {
  blobDownloadUrl,
  deleteFileBlob,
  statFileBlob,
  storeFileBlob,
} from "./storage/blob-driver";
import { isBlobKey, type StorageDriver } from "./storage/storage-key";

export { FileTooLargeError, type StoredFile };
export { isBlobKey, type StorageDriver };
export { blobDownloadUrl };

/**
 * Which driver new writes go to. Resolution order:
 *   1. STORAGE_DRIVER env, when set — must be "local" or
 *      "vercel-blob"; anything else throws (a typo'd driver name
 *      silently falling back to disk would lose prod uploads).
 *   2. BLOB_READ_WRITE_TOKEN present → "vercel-blob".
 *   3. Otherwise "local".
 *
 * Read per-call (not at module load) so env changes in tests — and
 * Vercel's runtime-injected token — are always honored.
 */
export function activeStorageDriver(): StorageDriver {
  const explicit = process.env.STORAGE_DRIVER;
  if (explicit !== undefined && explicit !== "") {
    if (explicit !== "local" && explicit !== "vercel-blob") {
      throw new Error(
        `Unknown STORAGE_DRIVER "${explicit}" — expected "local" or "vercel-blob".`
      );
    }
    if (explicit === "vercel-blob" && !process.env.BLOB_READ_WRITE_TOKEN) {
      throw new Error(
        'STORAGE_DRIVER="vercel-blob" requires BLOB_READ_WRITE_TOKEN to be set.'
      );
    }
    return explicit;
  }
  return process.env.BLOB_READ_WRITE_TOKEN ? "vercel-blob" : "local";
}

/** Persist an uploaded `File` and return what the DB needs to store
 *  (`key` round-trips into `Document.fileUrl`). Small files only
 *  under the blob driver — see the module docstring. */
export async function storeFile(file: File): Promise<StoredFile> {
  return activeStorageDriver() === "vercel-blob"
    ? storeFileBlob(file)
    : storeFileLocal(file);
}

/** Stream an incoming file to storage without buffering — the
 *  GB-scale write path. LOCAL DRIVER ONLY; throws under vercel-blob
 *  (prod GB uploads go client-direct, see /api/documents/upload/blob). */
export async function storeStream(
  source: Readable,
  originalName: string,
  maxBytes: number
): Promise<{ key: string; size: number }> {
  if (activeStorageDriver() !== "local") {
    throw new Error(
      "storeStream is local-driver-only — under vercel-blob, large uploads go client-direct (POST /api/documents/upload/blob)."
    );
  }
  return storeStreamLocal(source, originalName, maxBytes);
}

/** Open a read stream for download routes (local keys only — blob
 *  documents are served by 302ing to their URL, never proxied). */
export function openReadStream(
  key: string,
  range?: { start: number; end: number }
): NodeJS.ReadableStream {
  if (isBlobKey(key)) {
    throw new Error(
      "openReadStream cannot stream a blob URL — redirect to it instead."
    );
  }
  return openReadStreamLocal(key, range);
}

/** Best-effort delete — used when a Document row is removed and on
 *  upload-failure cleanup. Dispatches on KEY SHAPE, not the active
 *  driver, so rows written under a previous driver still clean up. */
export async function deleteFile(key: string): Promise<void> {
  return isBlobKey(key) ? deleteFileBlob(key) : deleteFileLocal(key);
}

/** Existence + size probe (download route: missing file → 410).
 *  Key-shape dispatch, same rationale as `deleteFile`. */
export async function statFile(
  key: string
): Promise<{ size: number } | null> {
  return isBlobKey(key) ? statFileBlob(key) : statFileLocal(key);
}
