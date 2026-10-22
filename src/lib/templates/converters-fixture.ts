/** Test fixtures: a template with a table and a bullet list, and a court caption. */
import { SAMPLE_TEMPLATE_DATA } from "./catalog";
import { renderTemplate, type ResolvedDoc, type ResolvedTableCell } from "./render";
import type { TableCellNode } from "./schema";
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

const p = (text: string, bold = false, textAlign?: "center") => ({
  type: "paragraph" as const,
  ...(textAlign ? { attrs: { textAlign } } : {}),
  content: [
    { type: "text" as const, text, ...(bold ? { marks: [{ type: "bold" as const }] } : {}) },
  ],
});
const capCell = (
  attrs: TableCellNode["attrs"],
  ...content: ReturnType<typeof p>[]
): ResolvedTableCell => ({ type: "tableCell", attrs, content });

/**
 * A Colorado-style caption (JDF "flexible caption"): court and parties on
 * the left, a court-use box on the right, thick rules around the parties,
 * and the title across both columns.
 */
export function captionFixture(): ResolvedDoc {
  return {
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              capCell(
                { colwidth: [400] },
                p("☐ County Court ☒ District Court"),
                p("Court Address: 1437 Bannock St"),
              ),
              capCell({ colwidth: [200], borders: { bottom: "none" } }, p("")),
            ],
          },
          {
            type: "tableRow",
            content: [
              capCell(
                { borders: { top: "thick", bottom: "thick" } },
                p("Plaintiff: Sam Sample", true),
              ),
              capCell(
                { verticalAlign: "bottom", borders: { top: "none", bottom: "thick" } },
                p("▲ COURT USE ONLY ▲", true, "center"),
              ),
            ],
          },
          {
            type: "tableRow",
            content: [capCell({}, p("Attorney: Pat Lawyer")), capCell({}, p("Case Number:"))],
          },
          {
            type: "tableRow",
            content: [capCell({ colspan: 2 }, p("MOTION TO DISMISS", true, "center"))],
          },
        ],
      },
    ],
  };
}

/** The same caption with the court-use box as one cell spanning two rows. */
export function mergedCaptionFixture(): ResolvedDoc {
  return {
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              capCell({ colwidth: [400] }, p("☐ County Court ☒ District Court")),
              capCell(
                {
                  colwidth: [200],
                  rowspan: 2,
                  verticalAlign: "bottom",
                  borders: { bottom: "thick" },
                },
                p("▲ COURT USE ONLY ▲", true, "center"),
              ),
            ],
          },
          {
            type: "tableRow",
            content: [
              capCell(
                { borders: { top: "thick", bottom: "thick" } },
                p("Plaintiff: Sam Sample", true),
                p("v."),
                p("Defendant: Dana Doe", true),
              ),
            ],
          },
          {
            type: "tableRow",
            content: [capCell({}, p("Attorney: Pat Lawyer")), capCell({}, p("Case Number:"))],
          },
          {
            type: "tableRow",
            content: [capCell({ colspan: 2 }, p("MOTION TO DISMISS", true, "center"))],
          },
        ],
      },
    ],
  };
}
