import { describe, expect, test } from "vitest";
import { textareaToHtml } from "./text-to-html";

describe("textareaToHtml", () => {
  test("keeps line breaks as <br> (CRLF and LF)", () => {
    expect(textareaToHtml("a\nb\r\nc")).toBe("a<br>b<br>c");
  });

  test("escapes angle brackets and ampersands instead of dropping them", () => {
    expect(textareaToHtml("Re: <Smith> & Co")).toBe(
      "Re: &lt;Smith&gt; &amp; Co"
    );
  });

  test("never lets markup through", () => {
    expect(textareaToHtml("<script>alert(1)</script>")).not.toContain(
      "<script"
    );
  });
});
