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
  isEffectivelyEmpty,
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
