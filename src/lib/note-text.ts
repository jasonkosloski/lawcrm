/**
 * Single-line plain text of note HTML.
 *
 * Note bodies are stored as entity-encoded HTML ("Smith & Jones" is
 * "Smith &amp; Jones"), so stripping tags alone leaves literal
 * `&amp;` / `&lt;` in anything built from the result: the Convert-to-
 * task prefill, the Notes-tab search haystack, activity previews and
 * reply-chip labels. This strips tags, decodes entities and collapses
 * whitespace; tags go first so a decoded "&lt;" can't be re-read as
 * markup.
 */

import { decodeHtmlEntities } from "@/lib/html-to-text";

export function noteToPlainText(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}
