/**
 * Shared HTML sanitizer for user-submitted Tiptap output.
 *
 * Three callers (notes, captures, inbox replies) post HTML from the
 * same Tiptap StarterKit editor. The allowed tag/attr surface is
 * identical across all three; this module is the single source of
 * truth so a tag added to the editor only has to be allow-listed
 * once.
 *
 * **Why `sanitize-html` and not `isomorphic-dompurify`:** the latter
 * pulls in jsdom on the server, and jsdom's transitive dep tree
 * (`html-encoding-sniffer` → `@exodus/bytes/encoding-lite.js`) hits
 * a CJS-requires-ESM error when bundled by Next/Turbopack on
 * Vercel. `sanitize-html` is pure JS (`htmlparser2` under the
 * hood), no DOM, no native deps, no serverless drama.
 *
 * The output is exactly the markup Tiptap emits when a user uses
 * its StarterKit toolbar. Anything else — `<script>`, `<iframe>`,
 * `onerror=`, `style=`, `javascript:` URLs — gets stripped.
 */

import sanitizeHtml from "sanitize-html";

/** Tags emitted by Tiptap StarterKit + a couple Tiptap extensions
 *  we use (link, underline, strikethrough). Keep this list in
 *  lockstep with the editor — adding a new mark/node in Tiptap
 *  without listing it here means user content silently disappears. */
const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "s",
  "u",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "a",
  "span",
];

/** Per-tag allowed attributes. `*` is sanitize-html's wildcard for
 *  "every tag" — we use it for the link-related attributes on `a`
 *  (only `a` will actually carry them, but listing them under `*`
 *  is simpler than maintaining a per-tag map). `class` is allowed
 *  on every tag because Tiptap uses it for things like task-list
 *  marker styling and we trust the markup we receive. */
const ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions["allowedAttributes"] = {
  a: ["href", "target", "rel", "class"],
  "*": ["class"],
};

/** Force every <a> tag to carry `rel="noopener noreferrer"` and
 *  `target="_blank"` so external links can't reverse-tabnab the
 *  parent window. Applied as a transform inside sanitize-html so
 *  it runs on every <a>, even ones the author didn't manually
 *  configure. */
const TRANSFORM_TAGS: sanitizeHtml.IOptions["transformTags"] = {
  a: (tagName, attribs) => ({
    tagName,
    attribs: {
      ...attribs,
      rel: "noopener noreferrer",
      target: "_blank",
    },
  }),
};

/** sanitize-html allows `http`, `https`, `mailto`, `tel`, `ftp`
 *  by default. We narrow to the four we actually want from a
 *  legal-CRM note body — anything `javascript:` or `data:` is
 *  rejected (the latter is a known XSS vector even when the
 *  payload looks like an image). */
const ALLOWED_SCHEMES = ["http", "https", "mailto", "tel"];

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: ALLOWED_ATTRIBUTES,
  allowedSchemes: ALLOWED_SCHEMES,
  // Drop the contents of disallowed tags too — `<script>alert(1)</script>`
  // becomes "" instead of "alert(1)". The default is to keep text content.
  disallowedTagsMode: "discard",
  transformTags: TRANSFORM_TAGS,
};

export function sanitizeUserHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS).trim();
}

/** True when the sanitized HTML has any non-whitespace visible text.
 *  Used to reject empty notes (a user clicking "Save" on an editor
 *  that only contains whitespace + tag scaffolding). */
export function isEffectivelyEmpty(html: string): boolean {
  const textOnly = html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;| /g, "")
    .trim();
  return textOnly.length === 0;
}
