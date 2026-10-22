import { describe, expect, it } from "vitest";
import { SAMPLE_TEMPLATE_DATA } from "./catalog";
import { DEFAULT_DOCUMENT_STYLE } from "./page-style";
import { logoPreviewUrl, renderPageView, styleBlockIds } from "./page-render";
import type { BlockSource } from "./render";
import type { TemplateDoc } from "./schema";
import { resolvedToText } from "./to-text";

const doc = (text: string): TemplateDoc => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const blocks = new Map<string, BlockSource>([
  ["lh", { id: "lh", name: "Letterhead", isActive: false, content: doc("HEAD") }],
  ["ct", { id: "ct", name: "Continuation", isActive: true, content: doc("CONT") }],
]);
const style = { ...DEFAULT_DOCUMENT_STYLE, letterheadBlockId: "lh", continuationBlockId: "ct" };
const data = { ...SAMPLE_TEMPLATE_DATA, scope: "matter" as const };

describe("renderPageView", () => {
  it("renders letter blocks into the page, reporting archived ones once", () => {
    const { page, report } = renderPageView({
      doc: { type: "doc", content: [{ type: "block", attrs: { blockId: "lh" } }] },
      kind: "letter",
      data,
      blocks,
      style,
      logo: { position: "left" },
      logoUrl: logoPreviewUrl("2026-10-22T00:00:00.000Z"),
    });
    expect(report.archivedBlocks).toEqual(["Letterhead"]);
    expect(resolvedToText(page.continuation!)).toBe("CONT");
    expect(page.style.letterhead).toEqual({ blockId: "lh", logo: { position: "left" } });
    expect(page.logoUrl).toBe("/api/document-style/logo?v=2026-10-22T00%3A00%3A00.000Z");
  });

  it("filings skip the style blocks and the logo", () => {
    expect(styleBlockIds("filing", style)).toEqual([]);
    const { page, report } = renderPageView({
      doc: doc("Body"),
      kind: "filing",
      data,
      blocks,
      style,
      logo: { position: "left" },
      logoUrl: "/x",
    });
    expect(page).toMatchObject({ letterhead: null, continuation: null, logoUrl: null });
    expect(report.archivedBlocks).toEqual([]);
  });
});
