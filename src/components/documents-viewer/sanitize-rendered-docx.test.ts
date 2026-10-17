// @vitest-environment happy-dom
/**
 * Unit tests for the docx-preview post-render sanitation pass.
 *
 * These run against constructed DOM (happy-dom) — the walker is pure
 * DOM-in/DOM-out, so building the attack markup directly is both
 * honest and exhaustive in a way a .docx fixture can't be (mammoth /
 * docx-preview would refuse to emit half of these shapes; the walker
 * must handle them anyway because it is the defense-in-depth layer
 * against library changes). The end-to-end proof that a hostile
 * OOXML relationship actually reaches — and is neutralized by — this
 * pass lives in docx-preview-renderer.test.tsx.
 */

import { describe, expect, test } from "vitest";
import {
  neutralizeExternalCssUrls,
  sanitizeDocxStyleSheet,
  sanitizeRenderedDocx,
} from "./sanitize-rendered-docx";

function build(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

describe("sanitizeRenderedDocx — anchor hrefs", () => {
  test("javascript: href is removed, text survives", () => {
    const root = build('<p><a href="javascript:alert(1)">click me</a></p>');
    const summary = sanitizeRenderedDocx(root);
    const a = root.querySelector("a")!;
    expect(a.hasAttribute("href")).toBe(false);
    expect(a.textContent).toBe("click me");
    expect(summary.neutralizedLinks).toBe(1);
  });

  test("scheme evasion: mixed case, leading whitespace, embedded tab", () => {
    // The URL parser normalizes these exactly like the browser would
    // — all three must land on the javascript: verdict.
    const root = build(
      '<a href="JaVaScRiPt:alert(1)">a</a>' +
        '<a href="   javascript:alert(2)">b</a>' +
        '<a href="java\tscript:alert(3)">c</a>'
    );
    const summary = sanitizeRenderedDocx(root);
    for (const a of root.querySelectorAll("a")) {
      expect(a.hasAttribute("href")).toBe(false);
    }
    expect(summary.neutralizedLinks).toBe(3);
  });

  test("data: and vbscript: hrefs are removed", () => {
    const root = build(
      '<a href="data:text/html,<script>alert(1)</script>">d</a>' +
        '<a href="vbscript:MsgBox(1)">v</a>'
    );
    const summary = sanitizeRenderedDocx(root);
    for (const a of root.querySelectorAll("a")) {
      expect(a.hasAttribute("href")).toBe(false);
    }
    expect(summary.neutralizedLinks).toBe(2);
  });

  test("http(s) links keep their href and gain _blank + noopener", () => {
    const root = build(
      '<a href="https://example.com/x">s</a><a href="http://example.com/y">p</a>'
    );
    const summary = sanitizeRenderedDocx(root);
    for (const a of root.querySelectorAll("a")) {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
      expect(a.hasAttribute("href")).toBe(true);
    }
    expect(summary.neutralizedLinks).toBe(0);
  });

  test("mailto: links are kept as-is (no _blank)", () => {
    const root = build('<a href="mailto:counsel@example.com">mail</a>');
    sanitizeRenderedDocx(root);
    const a = root.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("mailto:counsel@example.com");
    expect(a.hasAttribute("target")).toBe(false);
  });

  test("fragment-only bookmark links stay untouched", () => {
    // docx-preview emits these for internal bookmarks/footnotes —
    // rewriting them to _blank would break in-document navigation.
    const root = build('<a href="#footnote-3">3</a>');
    sanitizeRenderedDocx(root);
    const a = root.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("#footnote-3");
    expect(a.hasAttribute("target")).toBe(false);
  });
});

describe("sanitizeRenderedDocx — active content nodes", () => {
  test("script, iframe (srcdoc), object, embed are removed", () => {
    const root = build(
      "<p>before</p>" +
        "<script>alert(1)</script>" +
        '<iframe srcdoc="<script>alert(2)</script>"></iframe>' +
        '<object data="x"></object>' +
        '<embed src="x">' +
        "<p>after</p>"
    );
    const summary = sanitizeRenderedDocx(root);
    expect(root.querySelector("script, iframe, object, embed")).toBeNull();
    expect(summary.removedNodes).toBe(4);
    expect(root.textContent).toContain("before");
    expect(root.textContent).toContain("after");
  });

  test("inline handler attributes are stripped everywhere", () => {
    const root = build(
      '<p onclick="alert(1)">x</p><img onerror="alert(2)" src="data:image/gif;base64,R0lGOD">'
    );
    const summary = sanitizeRenderedDocx(root);
    expect(root.querySelector("[onclick]")).toBeNull();
    expect(root.querySelector("[onerror]")).toBeNull();
    expect(summary.strippedAttributes).toBe(2);
  });

  test("ping / srcset / formaction attributes are stripped", () => {
    const root = build(
      '<a href="https://example.com" ping="https://evil.example/track">x</a>' +
        '<img srcset="https://evil.example/1x.png 1x" src="data:image/gif;base64,R0lGOD">'
    );
    sanitizeRenderedDocx(root);
    expect(root.querySelector("[ping]")).toBeNull();
    expect(root.querySelector("[srcset]")).toBeNull();
  });
});

describe("sanitizeRenderedDocx — remote fetch canaries", () => {
  test("http(s) img src is removed (tracking pixel), data:/blob: kept", () => {
    const root = build(
      '<img src="https://evil.example/pixel.gif">' +
        '<img src="data:image/png;base64,iVBOR">' +
        '<img src="blob:https://app.example/123-456">'
    );
    sanitizeRenderedDocx(root);
    const imgs = root.querySelectorAll("img");
    expect(imgs[0].hasAttribute("src")).toBe(false);
    expect(imgs[1].getAttribute("src")).toBe("data:image/png;base64,iVBOR");
    expect(imgs[2].getAttribute("src")).toBe(
      "blob:https://app.example/123-456"
    );
  });

  test("external url() in a style attribute is emptied", () => {
    const root = build(
      '<p style="background-image: url(https://evil.example/bg.png); color: red">x</p>'
    );
    const summary = sanitizeRenderedDocx(root);
    const style = root.querySelector("p")!.getAttribute("style")!;
    expect(style).not.toContain("evil.example");
    expect(style).toContain("color: red");
    expect(summary.neutralizedCssUrls).toBe(1);
  });

  test("external url() in an injected <style> block is emptied; blob: @font-face kept", () => {
    const root = build(
      "<style>" +
        '@font-face { font-family: X; src: url("blob:https://app.example/font-1"); }' +
        ".docx p { background: url(//evil.example/c.png); }" +
        "</style>"
    );
    const summary = sanitizeRenderedDocx(root);
    const css = root.querySelector("style")!.textContent!;
    expect(css).toContain("blob:https://app.example/font-1");
    expect(css).not.toContain("evil.example");
    expect(summary.neutralizedCssUrls).toBe(1);
  });
});

describe("neutralizeExternalCssUrls", () => {
  test("quoted and unquoted external urls are emptied", () => {
    expect(
      neutralizeExternalCssUrls(
        'a { background: url("https://e.example/a") } b { background: url(https://e.example/b) }'
      )
    ).toEqual({
      css: "a { background: url() } b { background: url() }",
      neutralized: 2,
    });
  });

  test("data: and blob: urls survive, case-insensitively", () => {
    const css = "a { src: url(DATA:font/woff;base64,AA); b: url(blob:x) }";
    expect(neutralizeExternalCssUrls(css)).toEqual({ css, neutralized: 0 });
  });

  test("css without urls passes through untouched", () => {
    const css = ".docx { color: black; }";
    expect(neutralizeExternalCssUrls(css)).toEqual({ css, neutralized: 0 });
  });
});

describe("neutralizeExternalCssUrls — obfuscated forms (F124)", () => {
  test("escaped function name u\\rl( and hex-escaped url( are emptied", () => {
    for (const css of [
      "a { background: u\\rl(https://evil.example/a) }",
      "a { background: \\75 rl(https://evil.example/a) }",
      "a { background: \\000075\\72\\6c(https://evil.example/a) }",
      "a { background: URL(https://evil.example/a) }",
    ]) {
      const out = neutralizeExternalCssUrls(css);
      expect(out.css).not.toContain("evil.example");
      expect(out.neutralized).toBe(1);
    }
  });

  test("quoted targets containing ) or the other quote are emptied whole", () => {
    const a = neutralizeExternalCssUrls(
      'a { b: url("https://e.example/a)b") }'
    );
    expect(a.css).toBe("a { b: url() }");
    const b = neutralizeExternalCssUrls(
      `a { b: url("https://e.example/a'b") }`
    );
    expect(b.css).toBe("a { b: url() }");
    const c = neutralizeExternalCssUrls(
      "a { b: url( 'https://e.example/x' ) }"
    );
    expect(c.css).toBe("a { b: url() }");
  });

  test("prefixed names that merely end in url( are not url functions", () => {
    const css = "a { b: foo-url(https://e.example/a) }";
    expect(neutralizeExternalCssUrls(css)).toEqual({ css, neutralized: 0 });
  });
});

describe("sanitizeDocxStyleSheet — page-wide CSS breakout (F124)", () => {
  // What docx-preview 0.4.0 really emits for an hostile rFonts value.
  const BREAKOUT =
    'p.docx_evil span {\r\n  font-family: "x";}body::after{content:"INJECTED";' +
    "background:u\\rl(https://evil.example/leak)}.y{z:1;\r\n}\r\n";

  test("injected non-docx rules are dropped; the scoped rule stays", () => {
    const out = sanitizeDocxStyleSheet(BREAKOUT);
    expect(out.changed).toBe(true);
    expect(out.css).toContain("p.docx_evil span");
    expect(out.css).not.toContain("body::after");
    expect(out.css).not.toContain("INJECTED");
    expect(out.css).not.toContain("evil.example");
    expect(out.css).not.toContain(".y");
  });

  test("end to end through sanitizeRenderedDocx", () => {
    const root = document.createElement("div");
    const style = document.createElement("style");
    style.textContent = BREAKOUT;
    root.appendChild(style);
    const summary = sanitizeRenderedDocx(root);
    expect(style.textContent).not.toContain("body::after");
    expect(style.textContent).not.toContain("evil.example");
    expect(summary.neutralizedCssUrls).toBeGreaterThan(0);
  });

  test("selectors must ALL be docx-scoped; sibling/attr/:not/:root are dropped", () => {
    for (const sel of [
      "body",
      ".docx, body",
      ".docx ~ div",
      ".docx + div",
      ".docx-wrapper ~ *",
      "[data-x] .docx",
      ":root",
      "div:not(.docxfoo)",
      "#app .docx",
      ".notdocx p",
      ".docxish p",
    ]) {
      const out = sanitizeDocxStyleSheet(`${sel} { color: red; }`);
      expect(out.css, sel).toBe("");
      expect(out.changed, sel).toBe(true);
    }
  });

  test("docx-preview's own selector shapes are kept untouched", () => {
    const css =
      ".docx-wrapper { background: gray; padding: 30px; }\r\n" +
      ".docx-wrapper>section.docx { background: white; }\r\n" +
      "section.docx>article { margin-bottom: auto; z-index: 1; }\r\n" +
      ".docx table td, .docx table th { vertical-align: top; }\r\n" +
      "p.docx_heading1 span, p.docx_normal { font-size: 12pt; }\r\n" +
      "p.docx-num-1-0:before { content: '1.'; counter-increment: docx-num-1-0; }\r\n" +
      ".docx-wrapper { --docx-bullet: url(data:image/png;base64,AAAA) }\r\n";
    const out = sanitizeDocxStyleSheet(css);
    expect(out).toEqual({ css, neutralized: 0, changed: false });
  });

  test("docx-preview's table banding :not(.no-vband/.no-hband) selectors are kept", () => {
    const css =
      ".docx-wrapper table.docx_t td.odd-col:not(.no-vband) { background: #eee; }\n" +
      ".docx-wrapper table.docx_t tr.odd-row:not(.no-hband) td { background: #ddd; }\n";
    const out = sanitizeDocxStyleSheet(css);
    expect(out).toEqual({ css, neutralized: 0, changed: false });
    // Any other :not() / functional pseudo stays rejected.
    for (const sel of [
      ".docx p:not(.other)",
      ".docx p:not(.no-vband):has(a)",
      "body:not(.no-vband)",
    ]) {
      expect(sanitizeDocxStyleSheet(`${sel} { color: red; }`).css, sel).toBe(
        ""
      );
    }
  });

  test("@font-face with data:/blob: src survives, other at-rules go", () => {
    const font =
      "@font-face { font-family: F; src: url(data:font/ttf;base64,AAAA); }";
    const css =
      font +
      "@import url(https://evil.example/x.css);" +
      "@media print { .docx p { color: red } }" +
      "@font-face { font-family: G; src: url(https://evil.example/f.woff); }";
    const out = sanitizeDocxStyleSheet(css);
    expect(out.css).toContain("data:font/ttf;base64,AAAA");
    expect(out.css).not.toContain("@import");
    expect(out.css).not.toContain("@media");
    expect(out.css).not.toContain("evil.example");
  });

  test("a url token containing ; { } does not desync the walker", () => {
    // Browser reads url(...) as ONE token, so the real rule ends at the
    // final }. A walker that split on ; or } inside would leak the body rule.
    const css =
      ".docx p { background: url(https://e.example/a;b}c); }\r\nbody { color: red }";
    const out = sanitizeDocxStyleSheet(css);
    expect(out.css).not.toContain("e.example");
    expect(out.css).not.toContain("body");
  });

  test("a bad-url with a quote inside cannot swallow the next rule", () => {
    const css = '.docx p { background: url(a"b); } body { color: red }';
    const out = sanitizeDocxStyleSheet(css);
    expect(out.css).not.toContain("body");
  });

  test("position:fixed/sticky, big z-index, image-set, expression are dropped", () => {
    const out = sanitizeDocxStyleSheet(
      ".docx p { position: fixed; z-index: 2147483647; color: red; " +
        "background: image-set('https://evil.example/t' 1x); " +
        "background: -webkit-image-set(url(https://evil.example/t) 1x); " +
        "width: expression(alert(1)); position: sticky; " +
        "list-style: src(https://evil.example/x); behavior: url(x) }"
    );
    expect(out.css).toContain("color: red");
    for (const bad of [
      "fixed",
      "sticky",
      "2147483647",
      "image-set",
      "expression",
      "evil.example",
      "behavior",
    ]) {
      expect(out.css, bad).not.toContain(bad);
    }
  });

  test("unterminated constructs drop instead of leaking", () => {
    expect(sanitizeDocxStyleSheet(".docx p { color: red").css).toBe("");
    expect(sanitizeDocxStyleSheet('.docx p { content: "x }').css).toBe("");
    expect(sanitizeDocxStyleSheet(".docx p { a: url(x }").css).toBe("");
  });

  test("comment tricks cannot hide an external url or fetch function", () => {
    const out = sanitizeDocxStyleSheet(
      ".docx p { background: /* x */ url(https://evil.example/a) /* y */; " +
        "color: red; }"
    );
    expect(out.css).not.toContain("evil.example");
    expect(out.css).toContain("color: red");
  });
});

describe("sanitizeRenderedDocx — style attribute hardening (F124)", () => {
  test("escaped url(, image-set() and overlay positioning are removed", () => {
    const root = build(
      "<svg style=\"position:fixed;inset:0;z-index:2147483647;background:image-set('https://evil.example/t' 1x)\"></svg>" +
        '<p style="color: red; background: u\\rl(https://evil.example/a)">x</p>'
    );
    const summary = sanitizeRenderedDocx(root);
    const svg = root.querySelector("svg")!.getAttribute("style") ?? "";
    expect(svg).toContain("inset:0");
    expect(svg).not.toContain("fixed");
    expect(svg).not.toContain("2147483647");
    expect(svg).not.toContain("image-set");
    const p = root.querySelector("p")!.getAttribute("style")!;
    expect(p).toContain("color: red");
    expect(p).not.toContain("evil.example");
    expect(summary.neutralizedCssUrls).toBeGreaterThanOrEqual(4);
  });

  test("svg <image>/<use> with remote href loses it; fragments and data: stay", () => {
    const root = build(
      '<svg><image href="https://evil.example/p.png"></image>' +
        '<use href="#local"></use>' +
        '<image href="data:image/png;base64,AAAA"></image></svg>'
    );
    sanitizeRenderedDocx(root);
    const imgs = root.querySelectorAll("image");
    expect(imgs[0].hasAttribute("href")).toBe(false);
    expect(imgs[1].getAttribute("href")).toBe("data:image/png;base64,AAAA");
    expect(root.querySelector("use")!.getAttribute("href")).toBe("#local");
  });
});

describe("sanitizeRenderedDocx — benign render is left alone", () => {
  test("a docx-preview-shaped tree passes through structurally unchanged", () => {
    // Mimics what docx-preview actually emits: wrapper > section
    // pages, style block, spans, table with vertical-align, tab
    // spacers. None of it should be altered.
    const html =
      "<style>.docx-wrapper { background: gray; }</style>" +
      '<div class="docx-wrapper"><section class="docx"><article>' +
      '<p><span>IN THE CIRCUIT COURT</span><span style="text-decoration: underline; word-spacing: 120pt">&nbsp;</span></p>' +
      '<table><tr><td style="vertical-align: bottom; text-align: center"><p>Plaintiff</p></td></tr></table>' +
      "</article></section></div>";
    const root = build(html);
    const before = root.innerHTML;
    const summary = sanitizeRenderedDocx(root);
    expect(root.innerHTML).toBe(before);
    expect(summary).toEqual({
      removedNodes: 0,
      neutralizedLinks: 0,
      strippedAttributes: 0,
      neutralizedCssUrls: 0,
    });
  });
});
