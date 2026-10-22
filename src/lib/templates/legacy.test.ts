import { describe, expect, it } from "vitest";
import { convertLegacyBody } from "./legacy";
import { validateTemplateContent, type ParagraphNode } from "./schema";

describe("convertLegacyBody", () => {
  it("converts paragraphs, breaks, fields and keeps unknown tokens literal", () => {
    const doc = convertLegacyBody(
      "Dear {{client.name}},\n\nRe: {{ matter.name }}\n{{typo}} {{a{{b}}",
    );
    expect(doc.content).toHaveLength(2);
    expect(doc.content![0]).toEqual({
      type: "paragraph",
      attrs: { textAlign: null },
      content: [
        { type: "text", text: "Dear " },
        { type: "field", attrs: { path: "client.name", format: null } },
        { type: "text", text: "," },
      ],
    });
    expect(doc.content![1]).toEqual({
      type: "paragraph",
      attrs: { textAlign: null },
      content: [
        { type: "text", text: "Re: " },
        { type: "field", attrs: { path: "matter.name", format: null } },
        { type: "hardBreak" },
        { type: "text", text: "{{typo}} {{a{{b}}" },
      ],
    });
    expect(validateTemplateContent("letter", doc).ok).toBe(true);
  });
  it("empty string gives one empty paragraph", () => {
    const doc = convertLegacyBody("");
    expect(doc).toEqual({
      type: "doc",
      content: [{ type: "paragraph", attrs: { textAlign: null } }],
    });
    expect(validateTemplateContent("letter", doc).ok).toBe(true);
  });
  it("normalizes CRLF and whitespace-only blank lines", () => {
    expect(convertLegacyBody("a\r\n \r\nb").content).toHaveLength(2);
  });
  it("leaves list paths literal", () => {
    const doc = convertLegacyBody("{{parties.plaintiffs}}");
    expect((doc.content![0] as ParagraphNode).content).toEqual([
      { type: "text", text: "{{parties.plaintiffs}}" },
    ]);
  });
});
