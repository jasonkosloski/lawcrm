/**
 * File storage adapter — server-only.
 *
 * The thin layer between server actions and wherever bytes actually
 * live. Today: local filesystem at `./uploads/{key}`. Tomorrow:
 * Vercel Blob, S3, or whatever — change this file, leave every
 * caller alone.
 *
 * Keys are content-addressable-ish: `{cuid}__{slugified-name}`. The
 * cuid is the source of truth for "which row points at which file";
 * the human-readable suffix is a debugging convenience when you
 * `ls uploads/` and want to know what you're looking at.
 *
 * Storage is intentionally NOT public — files are never served
 * directly. Callers download via `/api/documents/[id]/download`,
 * which gates by session before streaming bytes. Firm-scoping of
 * the document lookup is deferred until Contact/Matter carry a
 * firmId (see the route's `findFirst` comment) — do NOT assume
 * tenant isolation here when adding a second firm.
 */

import { createReadStream } from "node:fs";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";

/// All uploaded files live under this directory (gitignored). The
/// path is resolved once at module load — every storage call uses
/// the same root regardless of process cwd.
const STORAGE_ROOT = resolve(process.cwd(), "uploads");

/** Generate a storage key. The cuid-ish prefix prevents collisions
 *  even when two users upload the same filename in the same second. */
function makeKey(originalName: string): string {
  const id = randomBytes(12).toString("base64url"); // ~16 chars
  // Strip path traversal + control chars; keep dots for the
  // extension so disk listings stay scannable.
  const safe = originalName
    .replace(/[/\\\x00-\x1f]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);
  return `${id}__${safe}`;
}

/** Absolute on-disk path for a key. Throws if the resolved path
 *  escapes STORAGE_ROOT (defense against path-traversal in keys
 *  loaded from the DB — keys we generate here are safe, but a
 *  belt-and-suspenders check is cheap). */
function resolveKey(key: string): string {
  const full = resolve(STORAGE_ROOT, key);
  if (!full.startsWith(STORAGE_ROOT + "/") && full !== STORAGE_ROOT) {
    throw new Error(`Refusing to read outside STORAGE_ROOT: ${key}`);
  }
  return full;
}

export type StoredFile = {
  /** Storage key; round-trip into `Document.fileUrl`. */
  key: string;
  size: number;
  contentType: string;
};

/** Persist an uploaded `File` and return what the DB needs to store. */
export async function storeFile(file: File): Promise<StoredFile> {
  const key = makeKey(file.name);
  const path = resolveKey(key);
  await mkdir(dirname(path), { recursive: true });
  // Buffer the whole upload — fine for the sizes we'll see at MVP
  // (≤25MB enforced upstream). Switch to streaming when we add
  // chunked uploads or a real cloud backend.
  const buf = Buffer.from(await file.arrayBuffer());
  await writeFile(path, buf);
  return {
    key,
    size: buf.byteLength,
    contentType: file.type || "application/octet-stream",
  };
}

/** Open a read stream for download routes. Wraps the on-disk
 *  path-traversal guard so callers can't be tricked. */
export function openReadStream(key: string): NodeJS.ReadableStream {
  return createReadStream(resolveKey(key));
}

/** Best-effort delete — used when a Document row is removed.
 *  Swallows "file gone" errors so the DB delete still wins. */
export async function deleteFile(key: string): Promise<void> {
  try {
    await unlink(resolveKey(key));
  } catch (err) {
    // ENOENT just means the file was already gone — fine.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/** Existence + size probe for the download route to set
 *  Content-Length without re-reading the whole file. */
export async function statFile(
  key: string
): Promise<{ size: number } | null> {
  try {
    const s = await stat(resolveKey(key));
    return { size: s.size };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}
