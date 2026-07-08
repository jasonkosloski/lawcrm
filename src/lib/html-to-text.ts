/**
 * Minimal HTML → plain-text downgrade for outbound email
 * (Email v1.1).
 *
 * The compose / reply composers author rich HTML in the shared
 * Tiptap editor; the text/plain half of the multipart/alternative
 * MIME message comes from this helper. Scope is deliberately the
 * editor's own output shape (the sanitizer's note-profile tags),
 * though it degrades gracefully on anything tag-shaped:
 *
 *   - block elements (p, headings, blockquote, pre, div, tr, …)
 *     separate with a blank line
 *   - <br> is a single newline
 *   - lists render as "- " bullets / "1. " numbers; nested lists
 *     indent two spaces per level; Tiptap's `<li><p>…</p></li>`
 *     wrapping does NOT produce stray blank lines
 *   - links render as "text (url)" — the "(url)" is omitted when
 *     the link text IS the url, and a text-less link prints its url
 *   - entities decode (common named + numeric decimal/hex)
 *   - whitespace collapses like HTML, except inside <pre>
 *   - <script>/<style> contents are dropped, not leaked as text
 *     (belt-and-braces — sanitized HTML never contains them)
 *
 * Zero dependencies, no DOM — a single-pass tag walk with a pending-
 * separator model (breaks are requested by tags and materialized by
 * the next visible text), safe in both the client composers and
 * server actions.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
  reg: "®",
  trade: "™",
};

/** Decode HTML entities: the common named set above plus numeric
 *  `&#123;` / `&#x1F;` forms. Unknown entities pass through verbatim
 *  (better to show "&weird;" than to eat it). */
export function decodeHtmlEntities(text: string): string {
  return text.replace(
    /&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (match, body: string) => {
      if (body.startsWith("#")) {
        const isHex = body[1] === "x" || body[1] === "X";
        const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) {
          return match;
        }
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? match;
    }
  );
}

/** Tags whose open/close request a paragraph boundary (blank line). */
const BLOCK_TAGS = new Set([
  "p",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "table",
  "tr",
  "section",
  "article",
  "header",
  "footer",
  "hr",
]);

/** Tags whose text content is never user-visible. */
const DROP_CONTENT_TAGS = new Set(["script", "style", "head", "title"]);

const HREF_RE = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

/** A line that so far only holds a list marker ("- " / "3. ") —
 *  breaks are suppressed right after it so Tiptap's `<li><p>` shape
 *  doesn't separate the marker from its text. */
const BARE_MARKER_RE = /(?:^|\n) *(?:-|\d+\.) $/;

type ListFrame = { ordered: boolean; count: number };
type AnchorFrame = { href: string | null; start: number };

export function htmlToText(html: string): string {
  // Matches a tag (capturing name + attributes, tolerating quoted
  // ">" inside attribute values) or an HTML comment.
  const TAG_RE =
    /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)\/?>|<!--[\s\S]*?-->/g;

  let out = "";
  let last = 0;
  /** Requested separator before the next visible text:
   *  0 = none, 1 = newline, 2 = blank line. */
  let pending = 0;
  let preDepth = 0;
  let dropDepth = 0;
  const lists: ListFrame[] = [];
  const anchors: AnchorFrame[] = [];

  const want = (level: 1 | 2): void => {
    pending = Math.max(pending, level);
  };

  /** Materialize the pending separator (optionally capped at a
   *  single newline — used between sibling list items). No-op at
   *  the very start and immediately after a bare list marker. */
  const flush = (cap?: 1): void => {
    const level = cap === undefined ? pending : Math.min(pending, cap);
    pending = 0;
    if (out === "" || level === 0) return;
    if (BARE_MARKER_RE.test(out)) return;
    out = out.replace(/[ \t]+$/, "");
    out += level === 1 ? "\n" : "\n\n";
  };

  const emitText = (raw: string): void => {
    if (!raw || dropDepth > 0) return;
    let text = decodeHtmlEntities(raw);
    if (preDepth === 0) {
      text = text.replace(/\s+/g, " ");
      if (text.trim() === "") {
        // Whitespace between inline tags ("…</em> <s>…") still
        // separates words — keep one space when no break is pending
        // and the output doesn't already end in whitespace.
        if (pending === 0 && out !== "" && !/[\s]$/.test(out)) out += " ";
        return;
      }
    }
    flush();
    if (preDepth === 0 && (out === "" || out.endsWith("\n"))) {
      text = text.replace(/^ +/, "");
    }
    out += text;
  };

  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(html)) !== null) {
    emitText(html.slice(last, m.index));
    last = TAG_RE.lastIndex;

    const name = m[1]?.toLowerCase();
    if (!name) continue; // comment
    const isClose = html[m.index + 1] === "/";
    const attrs = m[2] ?? "";

    if (DROP_CONTENT_TAGS.has(name)) {
      dropDepth = Math.max(0, dropDepth + (isClose ? -1 : 1));
      continue;
    }

    if (name === "br") {
      if (!isClose) {
        flush();
        if (out !== "") out += "\n";
      }
      continue;
    }

    if (name === "ul" || name === "ol") {
      if (isClose) {
        lists.pop();
        // Leaving a nested list only drops a line inside its parent
        // item; leaving the top level ends the block.
        if (lists.length === 0) want(2);
        else pending = 1;
      } else {
        if (lists.length === 0) want(2);
        else pending = 1; // nested list continues the current item
        lists.push({ ordered: name === "ol", count: 0 });
      }
      continue;
    }

    if (name === "li") {
      if (!isClose) {
        const frame = lists[lists.length - 1];
        want(1);
        // Sibling items sit on adjacent lines even when Tiptap's
        // <p> wrappers requested a paragraph break.
        flush(frame && frame.count > 0 ? 1 : undefined);
        const indent = "  ".repeat(Math.max(0, lists.length - 1));
        const marker = frame?.ordered ? `${++frame.count}. ` : "- ";
        if (frame && !frame.ordered) frame.count += 1;
        out += indent + marker;
      }
      continue;
    }

    if (name === "a") {
      if (!isClose) {
        const href = HREF_RE.exec(attrs);
        anchors.push({
          href: href ? decodeHtmlEntities(href[1] ?? href[2] ?? href[3]) : null,
          start: out.length,
        });
      } else {
        const frame = anchors.pop();
        if (frame?.href) {
          const text = out.slice(frame.start).trim();
          if (text === "") {
            flush();
            out += frame.href;
          } else if (text !== frame.href) {
            out += ` (${frame.href})`;
          }
        }
      }
      continue;
    }

    if (name === "pre") {
      preDepth = Math.max(0, preDepth + (isClose ? -1 : 1));
      want(2);
      continue;
    }

    if (BLOCK_TAGS.has(name)) {
      want(2);
      continue;
    }
    // Inline tags (strong/em/s/u/code/span/…) contribute nothing.
  }
  emitText(html.slice(last));

  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
