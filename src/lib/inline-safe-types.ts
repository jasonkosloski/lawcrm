/**
 * Inline-safe content types — the ONE allowlist every file-serving
 * route consults before rendering user-controlled bytes inline on
 * our origin. Extracted from /api/documents/[id]/download so the
 * email-attachment download route shares the exact same set (parity
 * by construction, not by copy-paste).
 *
 * Why an allowlist (the XSS reasoning, verbatim from the documents
 * route): the stored content type is *attacker-controlled* in both
 * cases — `Document.contentType` is the uploader's client-declared
 * MIME, and `EmailAttachment.contentType` is whatever the SENDER's
 * mail client declared. Serving attacker-declared `text/html` or
 * `image/svg+xml` inline would execute their markup on our origin
 * for whoever clicks the link — stored XSS riding a colleague's
 * (possibly admin) session. HTML and SVG are therefore deliberately
 * absent; add new types only if the browser can't execute script
 * from them.
 *
 * The media + text entries exist for the discovery viewer: browsers
 * render video/audio/image/plain-text passively — no script context
 * is ever created for them, and `X-Content-Type-Options: nosniff`
 * (set on every response by the serving routes) stops
 * re-interpretation of the bytes as anything active. text/plain and
 * text/csv render as inert text; markup inside them is displayed,
 * not executed.
 *
 * Pure module (a Set + a predicate) — safe to import from client
 * components that need the inline-viewable/force-download signal
 * for UX (e.g. showing a "View" affordance only for types that will
 * actually preview).
 */

export const INLINE_SAFE_TYPES: ReadonlySet<string> = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/webm",
  "audio/ogg",
  "text/plain",
  "text/csv",
]);

/** True when `contentType` may render inline. Compares on the bare
 *  media type — a stored value like "text/html; charset=utf-8" must
 *  not slip past the allowlist. Null/empty → false (octet-stream
 *  semantics: attachment only). */
export function isInlineSafeType(contentType: string | null): boolean {
  if (!contentType) return false;
  return INLINE_SAFE_TYPES.has(contentType.split(";")[0].trim().toLowerCase());
}
