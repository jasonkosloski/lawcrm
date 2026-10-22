import { describe, expect, test } from "vitest";
import { paragraphsToHtml, textareaToHtml } from "./text-to-html";

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

describe("paragraphsToHtml", () => {
  test("blank lines split paragraphs, single newlines become <br>", () => {
    expect(paragraphsToHtml("Hi,\r\n\r\nline one\nline two\n\n\n")).toBe(
      "<p>Hi,</p><p>line one<br>line two</p>"
    );
  });

  test("escapes markup and quotes", () => {
    expect(paragraphsToHtml(`<b>"Tom's"</b> & co`)).toBe(
      "<p>&lt;b&gt;&quot;Tom&#39;s&quot;&lt;/b&gt; &amp; co</p>"
    );
  });

  test("whitespace-only input is empty", () => {
    expect(paragraphsToHtml("  \n\n ")).toBe("");
  });
});
