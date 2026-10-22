/**
 * One-line plain-text preview of sanitized note HTML, for activity-log
 * `detail` strings.
 *
 * sanitize-html escapes text (`&` -> `&amp;`, `<` -> `&lt;`), and the
 * activity log renders `detail` as React text, so a preview built by
 * only stripping tags shows "Smith &amp; Jones". Strip the tags FIRST,
 * then decode entities (decoding first would turn an escaped
 * `&lt;script&gt;` into something tag-shaped), collapse whitespace and
 * only then cut to length, so an entity is never sliced in half.
 */

import { noteToPlainText } from "@/lib/note-text";

export function notePreviewText(
  html: string,
  fallback = "Note",
  max = 80
): string {
  return noteToPlainText(html).slice(0, max) || fallback;
}
