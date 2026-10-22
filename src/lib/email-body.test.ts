import { describe, expect, test } from "vitest";
import { isHtmlEmailBody } from "./email-body";
import { sanitizeEmailHtml } from "./sanitize-html";

describe("isHtmlEmailBody", () => {
  test.each([
    ["<p>Hello</p>", true],
    ["  \n\t<div>indented html</div>", true],
    ["<blockquote>quoted</blockquote>", true],
    ["Hello team,<br>please review<br><br>Thanks", true],
    ["Thanks <b>so much</b>", true],
    ['see <a href="https://x.test">link</a>', true],
    ["Hello <small>x</small>", true],
    ["E=mc<sup>2</sup> done", true],
    ["Plain text body\nwith newlines", false],
    ["if a < b and c > d then", false],
    ["Re: your email < my email", false],
    ["Reply to <john@example.com> please", false],
    ["", false],
    ["   \n  ", false],
  ])("%j → %s", (body, expected) => {
    expect(isHtmlEmailBody(body)).toBe(expected);
  });

  test.each([
    ["Hello AT&amp;T,<br />See you", true],
    ["Your statement<div>Body text</div>", true],
    ["Smith &amp; Jones", true],
  ])("sanitized HTML that starts with bare text: %j → %s", (body, expected) => {
    expect(isHtmlEmailBody(body)).toBe(expected);
  });

  test("real sanitizer output that begins with text is still HTML", () => {
    const bare = sanitizeEmailHtml("<html><body>Hello AT&T,<br>See you</body></html>");
    expect(bare.startsWith("<")).toBe(false);
    expect(isHtmlEmailBody(bare)).toBe(true);
  });

  test("a <title> block no longer leaks text in front of the body", () => {
    const out = sanitizeEmailHtml(
      "<html><head><title>Your statement</title></head><body><div>Body text</div></body></html>",
    );
    expect(out).toBe("<div>Body text</div>");
    expect(isHtmlEmailBody(out)).toBe(true);
  });
});
