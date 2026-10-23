import { describe, expect, it } from "vitest";
import { SAMPLE_TEMPLATE_DATA } from "./catalog";
import { DEFAULT_PARAGRAPH_STYLES } from "./page-style";
import { renderTemplate } from "./render";
import { convertLegacyBody } from "./legacy";
import { validateTemplateContent, type ParagraphNode } from "./schema";

describe("convertLegacyBody", () => {
  it("converts paragraphs, breaks, fields and keeps malformed tokens literal", () => {
    const doc = convertLegacyBody(
      "Dear {{client.name}},\n\nRe: {{ matter.name }}\n{{client name}} {{a{{b}}",
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
        { type: "text", text: "{{client name}} {{a{{b}}" },
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
  it("emits field nodes for well-formed keys outside the catalog", () => {
    const doc = convertLegacyBody("Hi {{client.nmae}}");
    expect((doc.content![0] as ParagraphNode).content).toEqual([
      { type: "text", text: "Hi " },
      { type: "field", attrs: { path: "client.nmae", format: null } },
    ]);
    expect(validateTemplateContent("letter", doc).ok).toBe(true);
    const { report } = renderTemplate(doc, {
      data: SAMPLE_TEMPLATE_DATA,
      blocks: new Map(),
      styles: DEFAULT_PARAGRAPH_STYLES,
    });
    expect(report.invalid).toContain("client.nmae");
  });
  it("keeps extra blank lines as empty paragraphs", () => {
    const doc = convertLegacyBody("a\n\n\n\nb\n\nc");
    expect(doc.content).toHaveLength(5);
    expect(doc.content!.map((n) => (n as ParagraphNode).content?.length ?? 0)).toEqual([
      1, 0, 0, 1, 1,
    ]);
    expect(validateTemplateContent("letter", doc).ok).toBe(true);
  });
});
