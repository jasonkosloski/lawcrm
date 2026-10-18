# ADR-018: Private Blob store + presigned URLs for documents

**Date:** 2026-10-16
**Status:** Accepted (supersedes ADR-015's public-access trade-off)

**Context:** ADR-015 put documents in a *public* Blob store: anyone holding a file's URL could fetch it, with the download route only controlling who was handed the URL. That was a stated trade-off while no real data existed. With the store going live for privileged client files (discovery, medical records, bodycam), a leaked link (forwarded email, browser history, a log line) granting access until deletion isn't acceptable. Vercel Blob's private access is generally available, and the store was still empty — the cheapest moment to switch.

**Decision:**
- One **private** store. Every write (`put`, client-direct `upload`) uses `access: "private"`; the stored key is still the full blob URL (`*.private.blob.vercel-storage.com/{key}`), so key-shape dispatch is unchanged.
- **Serving:** `/api/documents/[id]/download` and `/api/email-attachments/[id]/download` keep their session/scope checks, then 302 to a presigned GET URL from `signedBlobUrl` (`issueSignedToken` scoped to the one pathname, `get` only, then `presignUrl`). Lifetime: 15 minutes, or 6 hours for audio/video — a media element re-uses the redirect target for every Range request while seeking, so a short URL would break playback partway through a long recording. `download=1` (attachment disposition) is appended outside the signed payload. The redirect itself is `no-store`.
- **Server reads:** `readStoredFile` → `readBlobBytes`, an authenticated `get()` with a Range header for capped reads.
- **Rebuilt URL (addendum).** `signedBlobUrl` signs over the *decoded* pathname but returns a URL rebuilt from the stored origin with every path segment encoded, carrying across only the SDK's `vercel-blob-*` params. The SDK concatenates the pathname without encoding, so a `#`, `?` or `%` in a file name truncated or corrupted the URL.
- **Callback idempotency (addendum).** Vercel retries `onUploadCompleted` on non-2xx, so the handler (`src/app/api/documents/upload/blob/blob-upload.ts`) looks the Document up by `fileUrl` before creating it. There is no unique index on `Document.fileUrl` yet (Batch 4 candidate in `SCHEMA_NOTES.md`), so a true race can still double-insert.
- **Media lifetime.** The code's 6-hour media TTL (`SIGNED_MEDIA_URL_TTL_MS`) is the source of truth; any note quoting 12 hours is wrong.
- **Non-ASCII names (2026-10-18).** @vercel/blob 2.8.2 decodes the delegation token with Latin-1 `atob`, so its own scope check rejected any pathname with a non-ASCII character (accents, emoji, the U+202F in macOS screenshot names) and those files couldn't be viewed or downloaded. `presignUrlUtf8` in `src/lib/storage/blob-driver.ts` swaps in a UTF-8 `atob` for the synchronous part of the call only; token scope and signature are unchanged. Remove it once the SDK decodes UTF-8.
- Verified live against a private store before shipping: bare URL → 403; signed → 200; `download=1` → attachment with the signature intact; Range → 206; CORS allows the client-side docx renderer's fetch; a signature replayed against another pathname → 403.

**Trade-offs:**
- (+) A stored URL is no longer a credential; exposure from a leaked link is bounded to one file for minutes (hours for media)
- (+) Fixed server-side docx/text/CSV previews on the blob driver, which had been calling the local-only stream reader
- (-) One extra control-plane call (`issueSignedToken`) per download redirect
- (-) A signed media URL stays valid for up to 6 hours if leaked — scoped to that single file
- (-) Signed URLs can't be revoked early; deleting the file is the kill switch (bounded further by the 1-hour CDN cache TTL)
