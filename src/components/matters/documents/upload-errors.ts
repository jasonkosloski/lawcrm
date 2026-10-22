/**
 * Message mapping for client-direct Vercel Blob uploads.
 *
 * `upload()` from @vercel/blob/client discards the token route's
 * `{ error }` body: ANY non-2xx from /api/documents/upload/blob (folder
 * deleted mid-session, permission revoked, session expired, bad
 * payload) surfaces as `BlobError("Vercel Blob: Failed to  retrieve
 * the client token")` - note the SDK's double space. So that exact
 * text is the signature of "the server refused the upload"; the real
 * reason is only in the server log. Everything else (network drop,
 * abort, Blob-side rejection) keeps its own message - we don't mask
 * genuine connectivity errors as permission problems.
 */

export const UPLOAD_REJECTED_MESSAGE =
  "The upload was rejected - the folder may have been removed or you may have lost permission. Refresh the page and try again.";

const FALLBACK_MESSAGE = "Upload failed - check your connection and try again.";

export function blobUploadErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : "";
  if (/failed to\s+retrieve the client token/i.test(message)) {
    return UPLOAD_REJECTED_MESSAGE;
  }
  return message || FALLBACK_MESSAGE;
}
