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

describe("court replacements by kind", () => {
  const court = {
    id: "c1",
    name: "Court",
    isActive: true,
    values: {} as never,
    replacements: new Map<string, BlockSource>([
      ["ct", { id: "ct2", name: "Court continuation", isActive: true, content: doc("COURT CONT") }],
    ]),
  };
  const ref: TemplateDoc = { type: "doc", content: [{ type: "block", attrs: { blockId: "ct" } }] };
  const run = (kind: "letter" | "filing") =>
    renderPageView({ doc: ref, kind, data, blocks, style, logo: null, logoUrl: null, court });

  it("a filing body referencing the default block renders the replacement", () => {
    expect(resolvedToText(run("filing").page.body)).toBe("COURT CONT");
  });

  // Letterhead and continuation never render for filings (styleBlockIds is
  // empty), and a court is ignored on letters, so the continuation is
  // never swapped; the replacement reaches filings through the body only.
  it("letters ignore the court, including style blocks", () => {
    const { page } = run("letter");
    expect(resolvedToText(page.body)).toBe("CONT");
    expect(resolvedToText(page.continuation!)).toBe("CONT");
  });
});

describe("nested blocks on a page", () => {
  const ref = (blockId: string) => ({ type: "block" as const, attrs: { blockId } });
  const holding = (id: string, ...ids: string[]): BlockSource => ({
    id,
    name: id,
    isActive: true,
    content: { type: "doc", content: ids.map(ref) },
  });
  const courtWith = (replacements: [string, BlockSource][]) => ({
    id: "c1",
    name: "Court",
    isActive: true,
    values: {} as never,
    replacements: new Map(replacements),
  });
  const body: TemplateDoc = { type: "doc", content: [ref("A")] };
  const base = new Map<string, BlockSource>([
    ["A", holding("A", "S")],
    ["S", { id: "S", name: "S", isActive: true, content: doc("DEFAULT") }],
  ]);
  const filing = (court: ReturnType<typeof courtWith>) =>
    renderPageView({
      doc: body,
      kind: "filing",
      data,
      blocks: base,
      style,
      logo: null,
      logoUrl: null,
      court,
    });

  it("a court swap applies inside a nested block", () => {
    const r = { id: "R", name: "R", isActive: true, content: doc("COURT") };
    expect(resolvedToText(filing(courtWith([["S", r]])).page.body)).toBe("COURT");
  });

  it("a swap that includes the swapped block loops safely", () => {
    const { page, report } = filing(courtWith([["S", holding("R", "S")]]));
    expect(resolvedToText(page.body)).toBe("[Block includes itself]");
    expect(report.invalid).toEqual(["R (includes itself)"]);
  });

  it("letterhead may contain a nested block", () => {
    const { page } = renderPageView({
      doc: doc("Body"),
      kind: "letter",
      data,
      blocks: new Map([
        ["lh", holding("lh", "addr")],
        ["addr", { id: "addr", name: "Address", isActive: true, content: doc("1 Main St") }],
      ]),
      style: { ...DEFAULT_DOCUMENT_STYLE, letterheadBlockId: "lh", continuationBlockId: null },
      logo: null,
      logoUrl: null,
    });
    expect(resolvedToText(page.letterhead!)).toBe("1 Main St");
  });
});
