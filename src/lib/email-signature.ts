/**
 * Per-user email signatures (Settings → Profile).
 *
 * Stored on `User.emailSignature` as outgoing-profile HTML
 * (`sanitizeOutgoingEmailHtml`, the same allowlist sent mail uses). It is
 * sanitized on save (`normalizeEmailSignature`) and again on read, so
 * a row written by anything other than the profile action still can't
 * smuggle markup into mail wearing our From. The send actions sanitize
 * the whole body anyway; this keeps the composer preview honest too.
 *
 * Server-only (Prisma). The composer loaders (`ComposeEmailLauncher`,
 * `ReplySection`) call `getEmailSignature` and pass the result to the
 * client composers, which seed their editor from it and reset back to
 * it after a successful send.
 */

import { prisma } from "@/lib/prisma";
import { sanitizeOutgoingEmailHtml } from "@/lib/sanitize-html";
import { htmlToText } from "@/lib/html-to-text";

/** Longest signature HTML we store, measured after sanitizing. Generous
 *  for text + links; longer is refused rather than silently cut. */
export const EMAIL_SIGNATURE_MAX_LENGTH = 10_000;

/** Raw-input cap before sanitizing: pasted Word/Outlook markup shrinks a
 *  lot, so this only bounds the work the sanitizer is asked to do. */
export const EMAIL_SIGNATURE_MAX_INPUT_LENGTH = 200_000;

/** Sanitize a submitted signature; null when nothing visible is left
 *  (Tiptap's empty document is `<p></p>`). */
export function normalizeEmailSignature(html: string): string | null {
  const clean = sanitizeOutgoingEmailHtml(html);
  return htmlToText(clean).trim() === "" ? null : clean;
}

/** Editor-ready HTML for a stored signature: an empty paragraph so the
 *  caret starts above it, then the RFC 3676 "-- " delimiter. */
export function wrapEmailSignature(stored: string | null): string | null {
  const clean = stored ? normalizeEmailSignature(stored) : null;
  return clean ? `<p></p><p>-- </p>${clean}` : null;
}

/** The user's signature as composer-ready HTML, or null for none. */
export async function getEmailSignature(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { emailSignature: true },
  });
  return wrapEmailSignature(user?.emailSignature ?? null);
}
