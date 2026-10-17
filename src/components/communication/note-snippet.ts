/**
 * Plain-text quote for the reader's "note from email" prefill.
 *
 * EmailMessage.body is sanitized HTML for synced / CRM-sent mail (or
 * plain text for legacy rows). Slicing the raw body quoted markup -
 * often cut mid-tag - into the note; convert to text first, then cap.
 */

import { isHtmlEmailBody } from "@/lib/email-body";
import { htmlToText } from "@/lib/html-to-text";

/** Keeps the note dialog from being a wall of text on long emails. */
export const NOTE_SNIPPET_MAX = 400;

export function noteSnippet(body: string | null | undefined): string {
  if (!body) return "";
  const text = isHtmlEmailBody(body) ? htmlToText(body) : normalizePlain(body);
  return text.trim().slice(0, NOTE_SNIPPET_MAX);
}

/** Plain-text bodies: unify newlines, collapse runs of spaces, and
 *  keep at most one blank line (paragraph break) between blocks. */
function normalizePlain(body: string): string {
  return body
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}
