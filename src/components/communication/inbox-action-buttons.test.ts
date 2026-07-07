/**
 * Tests for the stripHtmlForTextarea entity-decode order.
 *
 * The regression worth pinning: &amp; must be decoded LAST. The
 * function used to decode it first, so a snippet containing the
 * literal text "&lt;" (escaped upstream to "&amp;lt;") was decoded
 * twice — "&amp;lt;" → "&lt;" → "<" — and the textarea showed "<"
 * where the sender actually wrote "&lt;".
 */

import { describe, expect, test, vi } from "vitest";

// The module is a client component that imports server actions;
// mock them so importing the helper doesn't pull server-only code.
vi.mock("@/app/actions/inbox-actions", () => ({
  createDeadlineFromEmail: vi.fn(),
  createDeadlineFromMessage: vi.fn(),
  createNoteFromEmail: vi.fn(),
  createNoteFromMessage: vi.fn(),
  createTaskFromEmail: vi.fn(),
  createTaskFromMessage: vi.fn(),
}));

import { stripHtmlForTextarea } from "./inbox-action-buttons";

describe("stripHtmlForTextarea — entity decoding", () => {
  test("decodes &amp; last so escaped literal entities survive one decode pass", () => {
    // Sender's plain text was "&lt;" — escaped upstream to "&amp;lt;".
    expect(stripHtmlForTextarea("<p>use &amp;lt; for less-than</p>")).toBe(
      "use &lt; for less-than"
    );
  });

  test("still decodes ordinary entities", () => {
    expect(
      stripHtmlForTextarea("<p>Smith &amp; Jones &lt;3 &quot;win&quot; &#39;em&#39;</p>")
    ).toBe("Smith & Jones <3 \"win\" 'em'");
  });

  test("roundtrips through textareaToHtml-style escaping without drift", () => {
    // The counterpart escape (& first, then < >) of the decoded text
    // must reproduce the original entity sequence.
    const original = "use &amp;lt; here";
    const decoded = stripHtmlForTextarea(`<p>${original}</p>`);
    const reEscaped = decoded
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    expect(reEscaped).toBe(original);
  });
});
