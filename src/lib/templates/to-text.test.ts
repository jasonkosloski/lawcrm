import { describe, expect, it } from "vitest";
import { resolvedToText } from "./to-text";
import { renderFixture } from "./converters-fixture";

describe("resolvedToText", () => {
  it("separates blocks with blank lines, renders lists and tables", () => {
    const text = resolvedToText(renderFixture());
    expect(text).toContain("Re: <b>Notice</b>\n\nDear ");
    expect(text).toContain("- one\n- two");
    expect(text).toContain("1. first");
    expect(text).toContain("A\tB\n1\t2");
    expect(text).toContain("[Signer bar number — not on file]");
    expect(text.endsWith("End")).toBe(true);
  });
  it("is empty for an empty doc", () => {
    expect(resolvedToText({ type: "doc" })).toBe("");
  });
});

import { defaultParagraphStyles } from "./paragraph-styles";
import { renderTemplate } from "./render";
import { SAMPLE_TEMPLATE_DATA } from "./catalog";
import { DEFAULT_DOCUMENT_STYLE } from "./page-style";
import type { TemplateDoc } from "./schema";

describe("resolvedToText all caps", () => {
  const styles = defaultParagraphStyles(DEFAULT_DOCUMENT_STYLE).map((s) =>
    s.key === "title" ? { ...s, values: { ...s.values, allCaps: true } } : s,
  );
  const run = (doc: unknown) =>
    resolvedToText(
      renderTemplate(doc as TemplateDoc, { data: SAMPLE_TEMPLATE_DATA, blocks: new Map(), styles })
        .doc,
    );
  it("uppercases a paragraph whose style is all caps", () => {
    const t = (text: string, attrs?: object, marks?: object[]) => ({
      type: "paragraph",
      attrs,
      content: [{ type: "text", text, marks }],
    });
    expect(
      run({
        type: "doc",
        content: [t("a title", { style: "title" }), t("b plain")],
      }),
    ).toBe("A TITLE\n\nb plain");
  });
  it("uppercases only the marked run", () => {
    expect(
      run({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "see " },
              { type: "text", text: "this", marks: [{ type: "allCaps" }] },
            ],
          },
        ],
      }),
    ).toBe("see THIS");
  });
});
