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

// ── Document profile ────────────────────────────────────────────────────
//
// A wider, still-passive allowlist for HTML produced by *our own*
// server-side converters (today: mammoth DOCX → HTML in
// `src/lib/document-preview.ts`). Word documents carry structure the
// Tiptap note profile deliberately lacks — tables, sup/sub, hr,
// embedded images — so this is a separate, additive profile. The
// note profile above is untouched: nothing here loosens what a note,
// capture, or inbox reply may contain.
//
// Threat model is the same as notes: the input is attacker-influenced
// (anyone with upload access controls the .docx bytes, and mammoth
// faithfully converts whatever markup tricks live inside), so we
// sanitize the converter's output before it ever reaches
// `dangerouslySetInnerHTML`. Script contexts stay impossible:
// no <script>/<iframe>/<style>, no event handlers or style attrs
// (sanitize-html strips unlisted attributes), and image sources are
// restricted to `data:` URIs — mammoth inlines embedded images as
// data URIs, and a data-URI <img> is a non-scripting context even
// for SVG payloads. http(s) image sources are deliberately absent:
// remote images would leak reader IPs/timestamps to whoever planted
// the URL in a discovery document (tracking-pixel canary).

/** Note-profile tags + the passive structural tags Word documents
 *  actually use (via mammoth's default style map). */
const DOCUMENT_ALLOWED_TAGS = [
  ...ALLOWED_TAGS,
  // Raw bold/italic (mammoth emits strong/em, but sanitizing b/i is
  // free and covers custom style maps).
  "b",
  "i",
  "sup",
  "sub",
  "hr",
  // Tables — contracts and discovery logs are full of them.
  "table",
  "caption",
  "colgroup",
  "col",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  // Embedded images (data: URIs only — see allowedSchemesByTag).
  "img",
];

const DOCUMENT_ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions["allowedAttributes"] =
  {
    ...ALLOWED_ATTRIBUTES,
    td: ["colspan", "rowspan", "class"],
    th: ["colspan", "rowspan", "class"],
    col: ["span", "class"],
    colgroup: ["span", "class"],
    img: ["src", "alt", "class"],
  };

const DOCUMENT_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: DOCUMENT_ALLOWED_TAGS,
  allowedAttributes: DOCUMENT_ALLOWED_ATTRIBUTES,
  allowedSchemes: ALLOWED_SCHEMES,
  // Images: data URIs only (mammoth inlines embedded media). No
  // remote fetches from inside a rendered document.
  allowedSchemesByTag: { img: ["data"] },
  // `//evil.example/x` would inherit our scheme and dodge the
  // scheme allowlist — reject protocol-relative URLs outright.
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: TRANSFORM_TAGS,
};

/** Sanitize converter-produced document HTML (DOCX preview). Same
 *  guarantees as `sanitizeUserHtml`, wider passive-structure
 *  allowlist. */
export function sanitizeDocumentHtml(html: string): string {
  return sanitizeHtml(html, DOCUMENT_OPTIONS).trim();
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
