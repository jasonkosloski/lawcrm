// @vitest-environment happy-dom
/** The block editor has styles but no page style: previews must use them. */
import { describe, expect, it } from "vitest";
import { DEFAULT_PARAGRAPH_STYLES } from "@/lib/templates/page-style";
import type { ParagraphStyle } from "@/lib/templates/paragraph-styles";
import type { BlockSource } from "@/lib/templates/render";
import type { TemplateDoc } from "@/lib/templates/schema";
import { blockPreview } from "./block-node";
import { renderSample } from "./preview-pane";

const custom: ParagraphStyle = {
  key: "pleading",
  name: "Pleading",
  builtIn: false,
  values: { ...DEFAULT_PARAGRAPH_STYLES[0].values, sizePt: 19 },
};
const FIRM = [
  ...DEFAULT_PARAGRAPH_STYLES.map((s) =>
    s.key === "body" ? { ...s, values: { ...s.values, sizePt: 15 } } : s,
  ),
  custom,
];
const doc = (style: string): TemplateDoc =>
  ({
    type: "doc",
    content: [{ type: "paragraph", attrs: { style }, content: [{ type: "text", text: "Hi" }] }],
  }) as never;

describe("previews use the editor's styles", () => {
  it("renderSample without a page style honors firm edits and custom styles", () => {
    const r = renderSample(doc("pleading"), null, "matter", [], "email", null, null, FIRM);
    expect(r.html).toContain("font-size:19pt");
    expect(r.report.unknownStyles).toEqual([]);
    const body = renderSample(doc("body"), null, "matter", [], "email", null, null, FIRM);
    expect(body.html).toContain("font-size:15pt");
  });

  it("without styles a custom style is flagged (the old false warning)", () => {
    const r = renderSample(doc("pleading"), null, "matter", [], "email");
    expect(r.report.unknownStyles.length).toBeGreaterThan(0);
  });

  it("the block chip preview uses the editor's styles", () => {
    const block: BlockSource = { id: "b", name: "B", isActive: true, content: doc("pleading") };
    expect(blockPreview("b", [block], FIRM)?.html).toContain("font-size:19pt");
    expect(blockPreview("b", [block])?.html).not.toContain("font-size:19pt");
  });

  it("the block chip preview shows a nested block's text", () => {
    const inner: BlockSource = {
      id: "inner",
      name: "Inner",
      isActive: true,
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Inner words" }] }],
      } as never,
    };
    const outer: BlockSource = {
      id: "outer",
      name: "Outer",
      isActive: true,
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Outer words" }] },
          { type: "block", attrs: { blockId: "inner" } },
        ],
      } as never,
    };
    const html = blockPreview("outer", [outer, inner])?.html;
    expect(html).toContain("Outer words");
    expect(html).toContain("Inner words");
  });
});
