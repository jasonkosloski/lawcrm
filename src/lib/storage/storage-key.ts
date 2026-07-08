/**
 * Storage-key scheme — shared, CLIENT-SAFE (no node: imports).
 *
 * One key scheme for every storage driver:
 *
 *     {random16-base64url}__{sanitized-original-name}
 *
 * The random prefix is the collision guard (two users uploading
 * "scan.pdf" in the same second get distinct keys); the suffix keeps
 * disk listings / blob dashboards human-scannable and preserves the
 * extension, which several layers derive the MIME type from.
 *
 * Where the key lives per driver (this is the key↔URL mapping the
 * rest of the app relies on — see ADR-015):
 *
 *   - local:        `Document.fileUrl` = the bare key; bytes at
 *                    `./uploads/{key}`.
 *   - vercel-blob:  the key is the blob *pathname*; the SDK returns
 *                    `https://<store>.public.blob.vercel-storage.com/{key}`
 *                    and `Document.fileUrl` stores that FULL URL
 *                    (it's what `del`/`head` accept and what the
 *                    download route redirects to). `isBlobKey`
 *                    distinguishes the two forms, so reads/deletes
 *                    can dispatch per-document rather than per-env —
 *                    a driver switch never strands existing rows.
 *
 * This module is imported by the client-direct blob uploader (the
 * browser generates the pathname before asking the token route for
 * permission), so it must stay free of Node-only APIs. Key
 * generation uses Web Crypto (`globalThis.crypto`), available in
 * both browsers and Node 20+. The token route re-validates the
 * shape server-side (`isValidStorageKey`) — the client picking its
 * own random prefix is fine because blob writes reject overwrites
 * (`allowOverwrite: false`), so a colliding/forged key can never
 * clobber someone else's file.
 */

/** Which storage driver is active. Client components receive this
 *  as a prop from a server component (they can't read env vars). */
export type StorageDriver = "local" | "vercel-blob";

/** Blob-stored keys are full `https://` URLs; local keys never
 *  contain a slash. One cheap test tells the two forms apart. */
export function isBlobKey(key: string): boolean {
  return key.startsWith("https://");
}

/** Sanitize an original filename into the key suffix: strip path
 *  separators + control chars, leading dots, cap the length. Keeps
 *  dots so the extension (MIME source of truth) survives. Mirrors
 *  what the local driver has always done — keys generated anywhere
 *  are byte-identical for the same inputs. */
export function sanitizeStorageName(originalName: string): string {
  return originalName
    .replace(/[/\\\x00-\x1f]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);
}

/** Generate a storage key: `{rand}__{safe-name}`. Isomorphic —
 *  the multi-file uploader calls this in the browser (client-direct
 *  blob uploads name their own pathname), the local driver calls it
 *  on the server. */
export function makeStorageKey(originalName: string): string {
  const bytes = new Uint8Array(12); // → 16 base64url chars
  globalThis.crypto.getRandomValues(bytes);
  const id = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${id}__${sanitizeStorageName(originalName)}`;
}

/** Server-side shape check for client-proposed blob pathnames: the
 *  random prefix, the `__` separator, and a suffix with no path
 *  separators or control characters. Rejecting anything else keeps
 *  the blob store's namespace exactly as opaque as local keys —
 *  no nested "folders", no crafted names. */
const STORAGE_KEY_RE =
  /^[A-Za-z0-9_-]{16}__(?!\.)[^/\\\x00-\x1f]{1,120}$/;

export function isValidStorageKey(key: string): boolean {
  return STORAGE_KEY_RE.test(key);
}
