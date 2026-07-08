/**
 * Post-render sanitation for the client-side docx-preview output.
 *
 * Discovery files are untrusted — whoever uploaded the .docx controls
 * every byte, including hyperlink targets and embedded parts. The
 * mammoth fallback path is sanitized server-side (`sanitizeDocumentHtml`);
 * this walker is the equivalent lock on the docx-preview path, run
 * once after `renderAsync` resolves and before the render is revealed.
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
 *   - url(...) references in <style> text and style attributes that
 *     aren't data:/blob: → emptied (CSS-based exfil canaries)
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

/** Empty every url(...) in a CSS text that doesn't target data:/blob:
 *  — external references leak the reviewer's IP the moment the style
 *  applies. Exported for direct unit testing. */
export function neutralizeExternalCssUrls(cssText: string): {
  css: string;
  neutralized: number;
} {
  let neutralized = 0;
  const css = cssText.replace(
    /url\(\s*(["']?)([^"')]*)\1\s*\)/gi,
    (match, _quote, target: string) => {
      const t = target.trim().toLowerCase();
      if (t.startsWith("data:") || t.startsWith("blob:")) return match;
      neutralized += 1;
      return "url()";
    }
  );
  return { css, neutralized };
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

    // style="... url(...)" — external CSS fetches.
    const styleAttr = el.getAttribute("style");
    if (styleAttr && /url\s*\(/i.test(styleAttr)) {
      const { css, neutralized } = neutralizeExternalCssUrls(styleAttr);
      if (neutralized > 0) {
        el.setAttribute("style", css);
        summary.neutralizedCssUrls += neutralized;
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
  //    legitimate url()s in there are blob: @font-face sources).
  for (const styleEl of Array.from(root.querySelectorAll("style"))) {
    const text = styleEl.textContent ?? "";
    if (!/url\s*\(/i.test(text)) continue;
    const { css, neutralized } = neutralizeExternalCssUrls(text);
    if (neutralized > 0) {
      styleEl.textContent = css;
      summary.neutralizedCssUrls += neutralized;
    }
  }

  return summary;
}
