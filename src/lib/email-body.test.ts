import { describe, expect, test } from "vitest";
import { isHtmlEmailBody } from "./email-body";

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
    ["", false],
    ["   \n  ", false],
  ])("%j → %s", (body, expected) => {
    expect(isHtmlEmailBody(body)).toBe(expected);
  });
});
