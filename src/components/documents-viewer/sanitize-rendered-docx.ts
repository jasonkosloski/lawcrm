/**
 * Post-render sanitation for the client-side docx-preview output.
 *
 * Discovery files are untrusted — whoever uploaded the .docx controls
 * every byte, including hyperlink targets and embedded parts. The
 * mammoth fallback path is sanitized server-side (`sanitizeDocumentHtml`);
 * this walker is the equivalent lock on the docx-preview path, run
 * once on the DETACHED render (parseAsync + renderDocument) before it is attached.
 *
 * What docx-preview actually constructs (verified against
 * docx-preview@0.4.0 dist): the document DOM is built node-by-node via
 * `document.createElement` / `createElementNS` (its `h` helper) — the
 * only `innerHTML` writes are constant strings (`""` to clear the
 * containers, `"&nbsp;"` for computed tab spacers), so document text
 * can never become markup. The one raw-HTML sink in the library is
 * altChunk rendering (`<iframe srcdoc={embedded HTML}>`), which the
 * renderer disables via `renderAltChunks: false`; the iframe strip
 * here is the second lock on that door. Everything below is therefore
 * defense in depth against library changes plus neutralization of the
 * things docx-preview DOES faithfully emit from attacker data:
 * anchor hrefs and (in theory) externally-referenced media.
 *
 *   - <script>/<iframe>/<object>/<embed> nodes → removed
 *   - inline handler attributes (on*) + ping/srcset/formaction → removed
 *   - a[href]: javascript:/data:/vbscript:/anything not http(s)/mailto
 *     → href removed; http(s) links get target="_blank"
 *     rel="noopener noreferrer"; fragment-only bookmark links kept
 *   - [src] that isn't data:/blob: (docx-preview only ever emits
 *     package-derived blob:/data: URLs) → removed, so a linked
 *     tracking pixel can't leak the reviewer's IP — parity with the
 *     mammoth profile's remote-image rule
 *   - <style> text (which docx-preview builds from unescaped document
 *     strings and which applies PAGE-WIDE) is re-built rule by rule:
 *     only rules scoped to docx-preview's own `.docx*` classes and
 *     blob:/data: @font-face survive, so a `}body::after{...}` breakout
 *     is dropped; style attributes get the same declaration filter
 *   - url(...) references (escaped names, quoted/unquoted targets) that
 *     aren't data:/blob:, and image-set()/src()/image() fetch functions
 *     → emptied/dropped (CSS-based exfil canaries); position:fixed|sticky
 *     and large z-index are dropped (overlay)
 *
 * Scheme checks go through `new URL(...)` so evasion tricks the
 * browser would honor (whitespace, tabs/newlines inside the scheme,
 * mixed case) are parsed exactly the way the browser will parse them.
 *
 * Mutates the container in place; returns counts so tests (and a
 * curious console) can see what was neutralized. Pure DOM in/out —
 * no component state — so it unit-tests in happy-dom directly.
 */

export type RenderedDocxSanitationSummary = {
  /** script/iframe/object/embed elements removed. */
  removedNodes: number;
  /** Anchors whose href was stripped (disallowed scheme). */
  neutralizedLinks: number;
  /** Inline-handler (on…) / ping / srcset / formaction attributes
   *  and non-blob/data src attributes removed. */
  strippedAttributes: number;
  /** <style> blocks / style attributes with external url() emptied. */
  neutralizedCssUrls: number;
};

const STRIP_NODE_SELECTOR = "script, iframe, object, embed";

/** Attributes that can cause a fetch or script eval regardless of
 *  element type. `src` is handled separately (blob:/data: allowed). */
const STRIP_ATTRIBUTES = new Set(["ping", "srcset", "formaction"]);

/** Resolve an attribute URL the way the browser will, or null when
 *  it can't parse. The dummy base means a relative URL reports the
 *  base's https: scheme — acceptable: relative hrefs/srcs are
 *  harmless (they can only point at our own origin). */
function urlProtocol(raw: string): string | null {
  try {
    return new URL(raw, "https://sanitizer.invalid/").protocol;
  } catch {
    return null;
  }
}

// ── CSS neutralization ──────────────────────────────────────────────────
//
// docx-preview concatenates attacker-controlled strings (rFonts values,
// theme typefaces, style ids, VML style text) into <style> text without
// escaping, and — because docx-preview would otherwise append them to the page —
// those <style> elements land in the live page where they apply
// DOCUMENT-WIDE. A value such as `"x";}body::after{...}.y{z:1` therefore
// breaks out of its rule and injects arbitrary page CSS (overlay, remote
// fetch canary, attribute-selector exfiltration). A regex over `url(...)`
// cannot fix that, so the <style> text is re-built from a small
// tokenizer-aware parser:
//
//   - rules survive only if EVERY comma-separated selector is scoped to
//     docx-preview's own class prefix (`.docx`, `.docx-wrapper`,
//     `.docx_Style`, ...) using only descendant / child combinators, so an
//     injected `body::after` / `.y` / `:root` / `~` / `:has()` rule is
//     dropped wholesale;
//   - @font-face survives (blob:/data: sources only); every other at-rule
//     (@import, @media, @namespace, ...) is dropped;
//   - declarations are filtered individually (position:fixed|sticky,
//     large z-index, behavior/-moz-binding/expression, image-set()/src()/
//     image()/... fetch functions, braces) and url() targets that are not
//     data:/blob: are emptied — url detection understands CSS escapes
//     (`u\rl(`), quoted strings containing `)` or quotes, and unquoted
//     url tokens containing `;`.
//
// Structure is determined by `walk`, which follows the CSS tokenizer
// rules that matter for boundaries (escapes, strings, comments, parens,
// unquoted url tokens). Anything the walker cannot prove balanced is
// dropped, and kept text is only ever re-emitted between braces/semicolons
// that this module writes itself.

/** Decode CSS escapes for DETECTION only (never re-emitted). */
function decodeCssEscapes(s: string): string {
  return s.replace(
    /\\(?:([0-9a-fA-F]{1,6})[ \t\n\r\f]?|([\s\S]))/g,
    (_m, hex: string | undefined, ch: string | undefined) => {
      if (hex !== undefined) {
        const cp = parseInt(hex, 16);
        if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
          return "�";
        }
        return String.fromCodePoint(cp);
      }
      return ch === "\n" ? "" : (ch ?? "");
    }
  );
}

/** Replace comments outside strings with a space (detection view only).
 *  Copies untouched runs by slice so multi-megabyte embedded fonts stay
 *  cheap. */
function stripCssComments(s: string): string {
  const parts: string[] = [];
  let runStart = 0;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") {
      i += 2;
    } else if (c === "/" && s[i + 1] === "*") {
      parts.push(s.slice(runStart, i), " ");
      const j = s.indexOf("*/", i + 2);
      i = j === -1 ? s.length : j + 2;
      runStart = i;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < s.length && s[j] !== c) j += s[j] === "\\" ? 2 : 1;
      i = j + 1;
    } else {
      i += 1;
    }
  }
  parts.push(s.slice(runStart));
  return parts.join("");
}

/** Detection view of a CSS fragment: comments gone, escapes decoded,
 *  lower-cased. */
function cssDetectionView(s: string): string {
  return decodeCssEscapes(stripCssComments(s)).toLowerCase();
}

// One letter of `url` as the tokenizer would read it: literal (any case),
// hex escape (u=75/55, r=72/52, l=6c/4c, optional leading zeros and one
// terminating space) or identity escape (`\u`, `\r`, `\l`).
const URL_NAME =
  String.raw`(?:u|\\0{0,4}[57]5[ \t\n\r\f]?|\\u)` +
  String.raw`(?:r|\\0{0,4}[57]2[ \t\n\r\f]?|\\r)` +
  String.raw`(?:l|\\0{0,4}[46]c[ \t\n\r\f]?|\\l)`;
const URL_FUNCTION = new RegExp(
  String.raw`(?<![\w\-\u0080-￿])` +
    URL_NAME +
    String.raw`\([ \t\n\r\f]*` +
    String.raw`(?:"((?:[^"\\\n]|\\[\s\S])*)"` +
    String.raw`|'((?:[^'\\\n]|\\[\s\S])*)'` +
    String.raw`|((?:[^)\\\s"'(]|\\[\s\S])*))` +
    String.raw`[ \t\n\r\f]*\)`,
  "gi"
);

function isInertUrlTarget(raw: string): boolean {
  const t = decodeCssEscapes(raw).trim().toLowerCase();
  return t.startsWith("data:") || t.startsWith("blob:");
}

/** Empty every url(...) in a CSS text that doesn't target data:/blob:
 *  — external references leak the reviewer's IP the moment the style
 *  applies. Understands escaped function names (`u\rl(`), quoted
 *  targets containing `)` / quotes, and unquoted targets. Exported for
 *  direct unit testing. */
export function neutralizeExternalCssUrls(cssText: string): {
  css: string;
  neutralized: number;
} {
  let neutralized = 0;
  const css = cssText.replace(
    URL_FUNCTION,
    (
      match,
      dq: string | undefined,
      sq: string | undefined,
      bare: string | undefined
    ) => {
      if (isInertUrlTarget(dq ?? sq ?? bare ?? "")) return match;
      neutralized += 1;
      return "url()";
    }
  );
  return { css, neutralized };
}

/** True when `css[openIdx]` is the `(` of a `url(` function (name read
 *  through escapes). */
function isUrlFunctionParen(css: string, openIdx: number): boolean {
  const lookback = decodeCssEscapes(
    css.slice(Math.max(0, openIdx - 24), openIdx)
  );
  return /(?:^|[^\w\-\u0080-￿])url$/i.test(lookback);
}

/**
 * Walk `css[from..to)` following CSS tokenizer boundaries and call
 * `onChar` for every structural character (outside strings, comments,
 * escapes, parens/brackets and unquoted url tokens). `depth` is the
 * paren/bracket nesting. Returns `closed: false` when a string, comment,
 * paren or url token is left open.
 */
function walk(
  css: string,
  from: number,
  to: number,
  onChar: (index: number, ch: string, depth: number) => boolean | void
): { closed: boolean } {
  let depth = 0;
  let closed = true;
  let i = from;
  while (i < to) {
    const c = css[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "/" && css[i + 1] === "*") {
      const j = css.indexOf("*/", i + 2);
      if (j === -1 || j + 2 > to) {
        closed = false;
        break;
      }
      i = j + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let terminated = false;
      while (j < to) {
        const d = css[j];
        if (d === "\\") {
          j += 2;
        } else if (d === c) {
          terminated = true;
          j += 1;
          break;
        } else if (d === "\n" || d === "\r" || d === "\f") {
          break;
        } else {
          j += 1;
        }
      }
      if (!terminated) {
        closed = false;
        break;
      }
      i = j;
      continue;
    }
    if (c === "(") {
      if (isUrlFunctionParen(css, i)) {
        let k = i + 1;
        while (k < to && /[ \t\n\r\f]/.test(css[k])) k += 1;
        if (css[k] !== '"' && css[k] !== "'") {
          // Unquoted url token (or bad-url): swallows everything up to
          // the next unescaped `)`, including `;` `{` `}` and quotes.
          let j = k;
          while (j < to && css[j] !== ")") j += css[j] === "\\" ? 2 : 1;
          if (j >= to) {
            closed = false;
            break;
          }
          i = j + 1;
          continue;
        }
      }
      depth += 1;
      i += 1;
      continue;
    }
    if (c === "[") {
      depth += 1;
      i += 1;
      continue;
    }
    if (c === ")" || c === "]") {
      depth = Math.max(0, depth - 1);
      i += 1;
      continue;
    }
    if (onChar(i, c, depth) === true) return { closed };
    i += 1;
  }
  if (depth !== 0) closed = false;
  return { closed };
}

/** Split a declaration list at top-level `;`. `unsafe` when it has
 *  stray braces or anything left open. */
function splitDeclarations(body: string): {
  pieces: string[];
  unsafe: boolean;
} {
  const cuts: number[] = [];
  let brace = false;
  const { closed } = walk(body, 0, body.length, (i, c, depth) => {
    if (depth !== 0) return;
    if (c === ";") cuts.push(i);
    else if (c === "{" || c === "}") brace = true;
  });
  const pieces: string[] = [];
  let start = 0;
  for (const cut of cuts) {
    pieces.push(body.slice(start, cut));
    start = cut + 1;
  }
  pieces.push(body.slice(start));
  return { pieces, unsafe: brace || !closed };
}

/** Value-level constructs that fetch resources (or run code) other than
 *  through a plain `url()`. docx-preview never emits any of these. */
const FETCH_FUNCTION =
  /(?:^|[^\w-])(?:-webkit-)?(?:image-set|cross-fade|image|element|paint|src)\s*\(|expression\s*\(|@import|javascript:|-moz-binding|behavior\s*:/;
const DENIED_PROPERTIES = new Set(["behavior", "-moz-binding"]);
const MAX_Z_INDEX = 10;

/** Decide whether one declaration may stay. Returns the (possibly
 *  rewritten) declaration, or null to drop it. */
function sanitizeDeclaration(
  raw: string,
  allowedProps: ReadonlySet<string> | null
): { text: string; neutralized: number } | null {
  if (raw.trim() === "") return { text: raw, neutralized: 0 };
  if (/[{}]/.test(raw)) return null;
  const view = cssDetectionView(raw);
  const colon = view.indexOf(":");
  if (colon === -1) return null;
  const prop = view.slice(0, colon).trim();
  const value = view.slice(colon + 1).trim();
  if (!/^(?:--)?[a-z_][\w-]*$/.test(prop) && !/^-[a-z][\w-]*$/.test(prop)) {
    return null;
  }
  if (DENIED_PROPERTIES.has(prop)) return null;
  if (allowedProps && !allowedProps.has(prop)) return null;
  // Test both the comment-stripped and the raw-decoded view so a
  // comment cannot be used to hide (or fake) a function name.
  if (
    FETCH_FUNCTION.test(view) ||
    FETCH_FUNCTION.test(decodeCssEscapes(raw).toLowerCase())
  ) {
    return null;
  }
  if (prop === "position" && /\b(?:fixed|sticky)\b/.test(value)) return null;
  if (prop === "z-index") {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n > MAX_Z_INDEX) return null;
  }
  const { css, neutralized } = neutralizeExternalCssUrls(raw);
  // Anything that still looks like a url( to an external target after
  // the pass (an unparsed variant) is not worth the risk.
  const after = cssDetectionView(css);
  for (const m of after.matchAll(/url\(/g)) {
    const target = after
      .slice((m.index ?? 0) + 4)
      .trimStart()
      .replace(/^["']/, "");
    if (!(
      target.startsWith(")") ||
      target.startsWith("data:") ||
      target.startsWith("blob:")
    )) {
      return null;
    }
  }
  return { text: css, neutralized };
}

function sanitizeDeclarationList(
  body: string,
  allowedProps: ReadonlySet<string> | null = null
): { css: string; neutralized: number; changed: boolean } {
  const { pieces, unsafe } = splitDeclarations(body);
  if (unsafe) return { css: "", neutralized: 1, changed: true };
  let neutralized = 0;
  let changed = false;
  const kept: string[] = [];
  for (const piece of pieces) {
    const res = sanitizeDeclaration(piece, allowedProps);
    if (res === null) {
      neutralized += 1;
      changed = true;
      continue;
    }
    if (res.text !== piece) changed = true;
    neutralized += res.neutralized;
    if (res.text.trim() !== "") kept.push(res.text.trim());
  }
  if (!changed) return { css: body, neutralized, changed: false };
  return { css: kept.join("; "), neutralized, changed: true };
}

/** Selector scoping: every selector must be a descendant/child chain that
 *  contains docx-preview's own class prefix. No sibling combinators,
 *  attribute selectors, `:not()/:has()/:is()`, ids, escapes or comments,
 *  so a kept rule can only ever match elements inside the rendered
 *  document. */
const SELECTOR_CHARSET = /^[\w\u0080-￿\s.>:*,-]+$/;
const DOCX_SCOPE = /\.docx(?:[_-]|(?![\w-]))/;
const FONT_FACE_PROPS = new Set([
  "font-family",
  "src",
  "font-weight",
  "font-style",
  "font-display",
  "unicode-range",
]);

/** The only two functional pseudo-classes docx-preview itself emits
 *  (table banding). Each is a pure narrowing of an already-scoped
 *  selector, so the literal tokens are stripped before the charset
 *  test rather than allowing parentheses in general. */
const BANDING_NOT = /:not\(\.no-(?:v|h)band\)/g;

function isScopedSelectorList(rawPrelude: string): boolean {
  const prelude = rawPrelude.replace(BANDING_NOT, "");
  if (!SELECTOR_CHARSET.test(prelude)) return false;
  const selectors = prelude.split(",");
  return selectors.every((s) => s.trim() !== "" && DOCX_SCOPE.test(s));
}

/** Rebuild docx-preview's <style> text, keeping only rules that are
 *  scoped to the rendered document. Exported for direct unit testing. */
export function sanitizeDocxStyleSheet(css: string): {
  css: string;
  neutralized: number;
  changed: boolean;
} {
  let neutralized = 0;
  let changed = false;
  const out: string[] = [];
  let i = 0;
  while (i < css.length) {
    let stop = -1;
    let stopCh = "";
    walk(css, i, css.length, (k, c, depth) => {
      if (depth === 0 && (c === "{" || c === ";")) {
        stop = k;
        stopCh = c;
        return true;
      }
    });
    if (stop === -1) {
      const rest = css.slice(i);
      if (rest.trim() === "") out.push(rest);
      else {
        changed = true;
        neutralized += 1;
      }
      break;
    }
    if (stopCh === ";") {
      // Statement at-rule (@import, @namespace, ...) or junk.
      changed = true;
      neutralized += 1;
      i = stop + 1;
      continue;
    }
    // Find the matching `}` of this block.
    let nest = 1;
    let end = -1;
    walk(css, stop + 1, css.length, (k, c, depth) => {
      if (depth !== 0) return;
      if (c === "{") nest += 1;
      else if (c === "}") {
        nest -= 1;
        if (nest === 0) {
          end = k;
          return true;
        }
      }
    });
    if (end === -1) {
      changed = true;
      neutralized += 1;
      break;
    }
    const prelude = css.slice(i, stop);
    const body = css.slice(stop + 1, end);
    const trimmed = prelude.trim();
    let allowedProps: ReadonlySet<string> | null = null;
    let ok: boolean;
    if (trimmed.startsWith("@")) {
      ok = /^@font-face$/i.test(trimmed);
      allowedProps = FONT_FACE_PROPS;
    } else {
      ok = isScopedSelectorList(trimmed);
    }
    if (ok) {
      const res = sanitizeDeclarationList(body, allowedProps);
      neutralized += res.neutralized;
      if (res.changed) {
        changed = true;
        out.push(`${prelude}{${res.css}}`);
      } else {
        out.push(css.slice(i, end + 1));
      }
    } else {
      changed = true;
      neutralized += 1;
    }
    i = end + 1;
  }
  return { css: changed ? out.join("") : css, neutralized, changed };
}

export function sanitizeRenderedDocx(
  root: HTMLElement
): RenderedDocxSanitationSummary {
  const summary: RenderedDocxSanitationSummary = {
    removedNodes: 0,
    neutralizedLinks: 0,
    strippedAttributes: 0,
    neutralizedCssUrls: 0,
  };

  // 1. Active-content elements — should never exist (see header),
  //    removed wholesale if they ever do.
  for (const el of Array.from(root.querySelectorAll(STRIP_NODE_SELECTOR))) {
    el.remove();
    summary.removedNodes += 1;
  }

  // 2. Per-element attribute pass.
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    // Inline handlers + fetch-capable attributes.
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || STRIP_ATTRIBUTES.has(name)) {
        el.removeAttribute(attr.name);
        summary.strippedAttributes += 1;
      }
    }

    // src: docx-preview only emits blob:/data: URLs it minted from
    // package parts — anything else is a remote fetch and goes.
    const src = el.getAttribute("src");
    if (src !== null) {
      const protocol = urlProtocol(src);
      if (protocol !== "data:" && protocol !== "blob:") {
        el.removeAttribute("src");
        summary.strippedAttributes += 1;
      }
    }

    // SVG/VML-derived elements can reference remote resources through
    // href / xlink:href (<image>, <use>, <feImage>); anchors are
    // handled in step 3. Only fragments and data:/blob: survive.
    if (el.tagName.toLowerCase() !== "a") {
      for (const name of ["href", "xlink:href"]) {
        const ref = el.getAttribute(name);
        if (ref === null || ref.trim().startsWith("#")) continue;
        const protocol = urlProtocol(ref.trim());
        if (protocol !== "data:" && protocol !== "blob:") {
          el.removeAttribute(name);
          summary.strippedAttributes += 1;
        }
      }
    }

    // style="..." — external CSS fetches, fetch functions, overlays.
    // Always parsed (no `url(` pre-gate: escaped/obfuscated forms and
    // image-set() would never reach a gated replacer).
    const styleAttr = el.getAttribute("style");
    if (styleAttr) {
      const res = sanitizeDeclarationList(styleAttr);
      if (res.changed) {
        el.setAttribute("style", res.css);
        summary.neutralizedCssUrls += res.neutralized;
      }
    }
  }

  // 3. Anchor hrefs.
  for (const a of Array.from(root.querySelectorAll("a[href]"))) {
    const raw = a.getAttribute("href") ?? "";
    // Fragment-only links are docx-preview's internal bookmark /
    // footnote navigation — same-page, keep untouched.
    if (raw.startsWith("#")) continue;
    const protocol = urlProtocol(raw.trim());
    if (protocol === "http:" || protocol === "https:") {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    } else if (protocol !== "mailto:") {
      // javascript:, data:, vbscript:, file:, unparseable, …
      a.removeAttribute("href");
      summary.neutralizedLinks += 1;
    }
  }

  // 4. <style> blocks docx-preview injects (document styles, fonts —
  //    legitimate url()s in there are blob:/data: @font-face sources).
  //    These apply page-wide, so they are re-built rule by rule and
  //    anything not scoped to the rendered document is dropped.
  for (const styleEl of Array.from(root.querySelectorAll("style"))) {
    const text = styleEl.textContent ?? "";
    const res = sanitizeDocxStyleSheet(text);
    if (res.changed) {
      styleEl.textContent = res.css;
      summary.neutralizedCssUrls += res.neutralized;
    }
  }

  return summary;
}
