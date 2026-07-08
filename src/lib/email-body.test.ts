import { describe, expect, test } from "vitest";
import { isHtmlEmailBody } from "./email-body";

describe("isHtmlEmailBody", () => {
  test.each([
    ["<p>Hello</p>", true],
    ["  \n\t<div>indented html</div>", true],
    ["<blockquote>quoted</blockquote>", true],
    ["Plain text body\nwith newlines", false],
    ["Re: your email < my email", false],
    ["", false],
    ["   \n  ", false],
  ])("%j → %s", (body, expected) => {
    expect(isHtmlEmailBody(body)).toBe(expected);
  });
});
