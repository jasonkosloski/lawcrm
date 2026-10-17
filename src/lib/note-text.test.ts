import { describe, expect, test } from "vitest";
import { noteToPlainText } from "./note-text";

describe("noteToPlainText", () => {
  test("strips tags and collapses whitespace", () => {
    expect(noteToPlainText("<p>Hello</p>\n<p>  big   world </p>")).toBe(
      "Hello big world"
    );
  });

  test("decodes entities so '&' round-trips (Convert-to-task title)", () => {
    // Stored HTML is entity-encoded: the old strip-only code left
    // "Smith &amp; Jones" in the prefilled task title.
    expect(noteToPlainText("<p>Call Smith &amp; Jones</p>")).toBe(
      "Call Smith & Jones"
    );
  });

  test("decodes &lt; / &gt; / &nbsp; / numeric entities", () => {
    expect(
      noteToPlainText("<p>re:&nbsp;&lt;redacted&gt; &#8212; ok</p>")
    ).toBe("re: <redacted> — ok");
  });

  test("tags are stripped before decoding, so a decoded < is never re-read as markup", () => {
    expect(noteToPlainText("<p>&lt;b&gt;bold&lt;/b&gt;</p>")).toBe(
      "<b>bold</b>"
    );
  });

  test("empty / tag-only input yields an empty string", () => {
    expect(noteToPlainText("")).toBe("");
    expect(noteToPlainText("<p></p><br>")).toBe("");
  });
});
