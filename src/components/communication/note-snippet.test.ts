import { describe, expect, test } from "vitest";
import { NOTE_SNIPPET_MAX, noteSnippet } from "./note-snippet";

describe("noteSnippet", () => {
  test("converts sanitized HTML to plain text instead of quoting markup", () => {
    const html =
      '<div class="WordSection1"><p class="MsoNormal"><span style="font-size:11.0pt">Counsel,</span></p><p>Please see the attached.</p></div>';
    const out = noteSnippet(html);
    expect(out).toContain("Counsel,");
    expect(out).toContain("Please see the attached.");
    expect(out).not.toMatch(/[<>]/);
    expect(out).not.toContain("WordSection1");
  });

  test("an HTML body that starts with bare text is still converted", () => {
    const out = noteSnippet("Hello<br>world <b>team</b>");
    expect(out).not.toMatch(/[<>]/);
    expect(out).toContain("Hello");
    expect(out).toContain("team");
  });

  test("legacy plain-text bodies pass through", () => {
    expect(noteSnippet("Line one\nLine two")).toBe("Line one\nLine two");
  });

  test("caps the TEXT (not the markup) at the max", () => {
    const html = `<p>${"word ".repeat(300)}</p>`;
    const out = noteSnippet(html);
    expect(out.length).toBeLessThanOrEqual(NOTE_SNIPPET_MAX);
    expect(out.length).toBeGreaterThan(300); // not eaten by tag bytes
  });

  test("empty / missing body -> empty string", () => {
    expect(noteSnippet(undefined)).toBe("");
    expect(noteSnippet(null)).toBe("");
    expect(noteSnippet("")).toBe("");
  });
});
