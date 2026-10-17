/**
 * htmlToText matrix — the outbound-email plain-text downgrade.
 * Inputs mirror what the shared Tiptap editor actually emits
 * (sanitizer note-profile tags), plus hostile/degenerate shapes.
 */

import { describe, expect, test } from "vitest";
import { decodeHtmlEntities, htmlToText } from "./html-to-text";

describe("htmlToText — paragraphs and breaks", () => {
  test("paragraphs separate with a blank line", () => {
    expect(htmlToText("<p>Hi Alice,</p><p>See attached.</p>")).toBe(
      "Hi Alice,\n\nSee attached."
    );
  });

  test("<br> is a single newline inside a paragraph", () => {
    expect(htmlToText("<p>Line one<br>Line two<br />Line three</p>")).toBe(
      "Line one\nLine two\nLine three"
    );
  });

  test("headings and blockquotes are their own blocks", () => {
    expect(
      htmlToText("<h2>Status</h2><p>All good.</p><blockquote><p>quoted</p></blockquote>")
    ).toBe("Status\n\nAll good.\n\nquoted");
  });

  test("empty editor output is empty text", () => {
    expect(htmlToText("<p></p>")).toBe("");
    expect(htmlToText("")).toBe("");
    expect(htmlToText("<p>   </p><p></p>")).toBe("");
  });

  test("empty paragraphs between content collapse to one blank line", () => {
    expect(htmlToText("<p>a</p><p></p><p></p><p>b</p>")).toBe("a\n\nb");
  });

  test("plain text without tags passes through", () => {
    expect(htmlToText("just words")).toBe("just words");
  });

  test("inline marks contribute only their text", () => {
    expect(
      htmlToText("<p>Hi <strong>Alice</strong>, <em>please</em> <s>don't</s> <code>sign()</code></p>")
    ).toBe("Hi Alice, please don't sign()");
  });
});

describe("htmlToText — lists", () => {
  test("bullet list → dash lines", () => {
    expect(htmlToText("<ul><li>One</li><li>Two</li></ul>")).toBe(
      "- One\n- Two"
    );
  });

  test("ordered list → numbered lines", () => {
    expect(htmlToText("<ol><li>First</li><li>Second</li></ol>")).toBe(
      "1. First\n2. Second"
    );
  });

  test("nested lists indent two spaces per level", () => {
    expect(
      htmlToText(
        "<ul><li>One</li><li>Two<ul><li>Sub A</li><li>Sub B</li></ul></li><li>Three</li></ul>"
      )
    ).toBe("- One\n- Two\n  - Sub A\n  - Sub B\n- Three");
  });

  test("ordered inside unordered keeps its own counter", () => {
    expect(
      htmlToText("<ul><li>Steps<ol><li>alpha</li><li>beta</li></ol></li></ul>")
    ).toBe("- Steps\n  1. alpha\n  2. beta");
  });

  test("Tiptap list items wrap content in <p> without extra blank lines", () => {
    expect(
      htmlToText("<ul><li><p>One</p></li><li><p>Two</p></li></ul>")
    ).toBe("- One\n- Two");
  });

  test("list between paragraphs keeps block separation", () => {
    expect(htmlToText("<p>Items:</p><ul><li>a</li></ul><p>Done.</p>")).toBe(
      "Items:\n\n- a\n\nDone."
    );
  });
});

describe("htmlToText — links", () => {
  test("link renders as text (url)", () => {
    expect(
      htmlToText('<p>See <a href="https://example.com/docs">the docs</a> now.</p>')
    ).toBe("See the docs (https://example.com/docs) now.");
  });

  test("url-as-text link prints once", () => {
    expect(
      htmlToText('<p><a href="https://example.com">https://example.com</a></p>')
    ).toBe("https://example.com");
  });

  test("text-less link prints its url", () => {
    expect(htmlToText('<p><a href="https://example.com"></a></p>')).toBe(
      "https://example.com"
    );
  });

  test("anchor without href is just its text", () => {
    expect(htmlToText("<p><a>bare</a></p>")).toBe("bare");
  });

  test("entity-encoded href decodes", () => {
    expect(
      htmlToText('<p><a href="https://example.com/?a=1&amp;b=2">q</a></p>')
    ).toBe("q (https://example.com/?a=1&b=2)");
  });
});

describe("htmlToText — entities and whitespace", () => {
  test("named, decimal and hex entities decode", () => {
    expect(
      htmlToText("<p>Costs &amp; fees &gt; $5&nbsp;000 &#8212; ok &#x2764;</p>")
    ).toBe("Costs & fees > $5 000 — ok ❤");
  });

  test("unknown entities pass through verbatim", () => {
    expect(htmlToText("<p>&notarealentity; stays</p>")).toBe(
      "&notarealentity; stays"
    );
  });

  test("source whitespace collapses like HTML", () => {
    expect(htmlToText("<p>a\n   b\t c</p>")).toBe("a b c");
  });

  test("<pre> preserves its whitespace", () => {
    expect(htmlToText("<pre>line 1\n  line 2</pre><p>after</p>")).toBe(
      "line 1\n  line 2\n\nafter"
    );
  });

  test("decodeHtmlEntities guards invalid code points", () => {
    expect(decodeHtmlEntities("&#1114112;")).toBe("&#1114112;"); // > 0x10FFFF
    expect(decodeHtmlEntities("&#x110000;")).toBe("&#x110000;");
  });
});

describe("htmlToText — hostile / degenerate shapes", () => {
  test("script and style contents are dropped, not leaked", () => {
    expect(
      htmlToText("<p>hi</p><script>alert(1)</script><style>p{color:red}</style>")
    ).toBe("hi");
  });

  test("comments are ignored", () => {
    expect(htmlToText("<p>a<!-- secret -->b</p>")).toBe("ab");
  });

  test("attributes with '>' in quoted values don't break the walk", () => {
    expect(htmlToText('<p title="a > b">ok</p>')).toBe("ok");
  });

  test("unclosed tags degrade without throwing", () => {
    expect(htmlToText("<p>open<ul><li>item")).toBe("open\n\n- item");
  });
});

describe("htmlToText - empty list items and ordered start (F674)", () => {
  test("an emptied middle bullet disappears instead of printing '- -'", () => {
    expect(
      htmlToText("<ul><li><p>a</p></li><li><p></p></li><li><p>x</p></li></ul>")
    ).toBe("- a\n- x");
  });

  test("an empty first bullet is dropped", () => {
    expect(htmlToText("<ul><li><p></p></li><li><p>x</p></li></ul>")).toBe(
      "- x"
    );
  });

  test("an empty bullet does not turn the next paragraph into a bullet", () => {
    expect(
      htmlToText("<p>a</p><ul><li><p></p></li></ul><p>b</p>")
    ).toBe("a\n\nb");
  });

  test("an empty numbered item is skipped and numbering stays contiguous", () => {
    expect(
      htmlToText("<ol><li>a</li><li></li><li>c</li></ol>")
    ).toBe("1. a\n2. c");
  });

  test("<ol start=N> numbers from N", () => {
    expect(
      htmlToText('<ol start="3"><li><p>Third</p></li><li><p>Fourth</p></li></ol>')
    ).toBe("3. Third\n4. Fourth");
  });

  test("a nested list after <ol start> keeps its own counter", () => {
    expect(
      htmlToText(
        '<ol start="5"><li>a<ul><li>sub</li></ul></li><li>b</li></ol>'
      )
    ).toBe("5. a\n  - sub\n6. b");
  });

  test("regular (non-empty) Tiptap lists are unchanged", () => {
    expect(
      htmlToText("<ul><li><p>one</p></li><li><p>two</p></li></ul>")
    ).toBe("- one\n- two");
  });
});
