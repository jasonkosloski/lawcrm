import { describe, expect, it } from "vitest";
import { convertHeadings } from "./headings";
import type { TemplateDoc } from "./schema";

const t = (s: string) => ({ type: "text", text: s });
const h = (level: number, textAlign?: string) => ({
  type: "heading",
  attrs: textAlign ? { level, textAlign } : { level },
  content: [t("Hi")],
});
const d = (...c: unknown[]) => ({ type: "doc", content: c }) as TemplateDoc;

describe("convertHeadings", () => {
  it("turns a heading into a styled paragraph, keeping alignment and content", () => {
    expect(convertHeadings(d(h(2, "center"), h(1)))).toEqual(
      d(
        {
          type: "paragraph",
          attrs: { style: "heading2", textAlign: "center" },
          content: [t("Hi")],
        },
        { type: "paragraph", attrs: { style: "heading1" }, content: [t("Hi")] },
      ),
    );
  });

  it("recurses through cells, show-if, repeat, lists and block-less docs", () => {
    const out = JSON.stringify(
      convertHeadings(
        d(
          { type: "showIf", attrs: {}, content: [h(3)] },
          { type: "repeat", attrs: {}, content: [h(1), { type: "repeatEmpty", content: [h(2)] }] },
          {
            type: "table",
            content: [{ type: "tableRow", content: [{ type: "tableCell", content: [h(1)] }] }],
          },
          { type: "bulletList", content: [{ type: "listItem", content: [h(2)] }] },
        ),
      ),
    );
    expect(out).not.toContain('"heading"');
    expect(out.match(/"style":"heading\d"/g)).toHaveLength(5);
  });

  it("does not mutate its input and leaves other content alone", () => {
    const input = d(h(1), { type: "paragraph", content: [t("x")] });
    const before = JSON.stringify(input);
    const out = convertHeadings(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(out.content?.[1]).toEqual(input.content?.[1]);
    expect(convertHeadings({ type: "doc" })).toEqual({ type: "doc" });
  });
});
