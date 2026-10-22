/** Test fixture: renders a template with a table and a bullet list. */
import { SAMPLE_TEMPLATE_DATA } from "./catalog";
import { renderTemplate, type ResolvedDoc } from "./render";
import type { TemplateDoc } from "./schema";

const cell = (text: string, header = false) => ({
  type: header ? ("tableHeader" as const) : ("tableCell" as const),
  content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text }] }],
});

export const fixtureTemplate: TemplateDoc = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 2, textAlign: "center" },
      content: [{ type: "text", text: "Re: <b>Notice</b>" }],
    },
    {
      type: "paragraph",
      attrs: { textAlign: "right" },
      content: [
        { type: "text", text: "Dear " },
        { type: "field", attrs: { path: "client.name", format: null }, marks: [{ type: "bold" }] },
        { type: "text", text: ", <script>alert(1)</script>" },
        { type: "hardBreak" },
        { type: "field", attrs: { path: "signer.barNumber", format: null } },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }],
        },
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "two" }] }],
        },
      ],
    },
    {
      type: "orderedList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }],
        },
      ],
    },
    {
      type: "table",
      content: [
        { type: "tableRow", content: [cell("A", true), cell("B", true)] },
        { type: "tableRow", content: [cell("1"), cell("2")] },
      ],
    },
    { type: "pageBreak" },
    {
      type: "paragraph",
      content: [{ type: "text", text: "End", marks: [{ type: "italic" }, { type: "underline" }] }],
    },
  ],
} as unknown as TemplateDoc;

export function renderFixture(): ResolvedDoc {
  return renderTemplate(fixtureTemplate, {
    data: { ...SAMPLE_TEMPLATE_DATA, signer: { ...SAMPLE_TEMPLATE_DATA.signer!, barNumber: null } },
    blocks: new Map(),
  }).doc;
}
