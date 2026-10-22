import { describe, expect, test } from "vitest";
import { notePreviewText } from "./note-preview";

describe("notePreviewText", () => {
  test("strips tags and collapses whitespace", () => {
    expect(notePreviewText("<p>Hello</p>\n<p>  big   world </p>")).toBe("Hello big world");
  });

  test("decodes sanitizer-escaped entities", () => {
    expect(notePreviewText('<p>Smith &amp; Jones said "no" &lt;today&gt;</p>')).toBe(
      'Smith & Jones said "no" <today>',
    );
  });

  test("decodes AFTER stripping, so an escaped tag stays text", () => {
    expect(notePreviewText("<p>&lt;script&gt;x&lt;/script&gt;</p>")).toBe("<script>x</script>");
  });

  test("cuts to the cap after decoding, never mid-entity", () => {
    const html = `<p>${"&amp;".repeat(100)}</p>`;
    expect(notePreviewText(html)).toBe("&".repeat(80));
  });

  test("falls back when there is no text", () => {
    expect(notePreviewText("<p> </p>")).toBe("Note");
    expect(notePreviewText("<p></p>", "Note added")).toBe("Note added");
  });
});
