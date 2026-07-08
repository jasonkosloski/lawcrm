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

describe("sanitizeRenderedDocx — benign render is left alone", () => {
  test("a docx-preview-shaped tree passes through structurally unchanged", () => {
    // Mimics what docx-preview actually emits: wrapper > section
    // pages, style block, spans, table with vertical-align, tab
    // spacers. None of it should be altered.
    const html =
      "<style>.docx-wrapper { background: gray; }</style>" +
      '<div class="docx-wrapper"><section class="docx"><article>' +
      "<p><span>IN THE CIRCUIT COURT</span><span style=\"text-decoration: underline; word-spacing: 120pt\">&nbsp;</span></p>" +
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
