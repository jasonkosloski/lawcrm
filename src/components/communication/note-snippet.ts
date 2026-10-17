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
  const text = isHtmlEmailBody(body) ? htmlToText(body) : body;
  return text.trim().slice(0, NOTE_SNIPPET_MAX);
}
