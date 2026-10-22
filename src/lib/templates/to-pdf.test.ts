import { PDFDocument, PDFName, PDFDict } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { FONTS } from "./fonts";
import { renderFixture } from "./converters-fixture";
import { DEFAULT_DOCUMENT_STYLE, resolvePageStyle, type PageStyle } from "./page-style";
import type { ResolvedDoc } from "./render";
import { resolvedToPdf } from "./to-pdf";

const para = (t: string, marks?: { type: "missing" }[]): ResolvedDoc["content"] => [
  { type: "paragraph", content: [{ type: "text", text: t, ...(marks ? { marks } : {}) }] },
];
const doc = (t: string, marks?: { type: "missing" }[]): ResolvedDoc => ({
  type: "doc",
  content: para(t, marks),
});

/** A body long enough to need two pages. */
const longBody = (): ResolvedDoc => ({
  type: "doc",
  content: Array.from({ length: 40 }, (_, i) => ({
    type: "paragraph" as const,
    content: [{ type: "text" as const, text: `Body line ${i + 1}` }],
  })),
});

const png = (() => {
  const b = new Uint8Array(33);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x89504e47);
  v.setUint32(12, 0x49484452);
  v.setUint32(16, 600);
  v.setUint32(20, 100);
  return b;
})();

const style = (kind: "letter" | "filing", over: Partial<PageStyle> = {}): PageStyle => ({
  ...resolvePageStyle(kind, DEFAULT_DOCUMENT_STYLE, null),
  ...over,
});

type Item = { str: string; y: number };

async function pages(buf: Buffer): Promise<Item[][]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
  const out: Item[][] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const tc = await (await pdf.getPage(i)).getTextContent();
    out.push(
      tc.items
        .filter((it): it is typeof it & { str: string } => "str" in it)
        .map((it) => ({ str: it.str, y: (it as { transform: number[] }).transform[5] })),
    );
  }
  return out;
}
const text = (p: Item[]) => p.map((i) => i.str).join(" ");

async function fontNames(buf: Buffer): Promise<string[]> {
  const pdf = await PDFDocument.load(buf);
  const names: string[] = [];
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && obj.get(PDFName.of("Type")) === PDFName.of("Font")) {
      const base = obj.get(PDFName.of("BaseFont"));
      if (base) names.push(String(base));
    }
  }
  return names;
}

describe("resolvedToPdf", () => {
  it("renders the fixture (table, lists, page break) as a valid PDF", async () => {
    const { buffer, warnings } = await resolvedToPdf({
      body: renderFixture(),
      letterhead: null,
      continuation: null,
      style: style("letter"),
    });
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    const ps = await pages(buffer);
    expect(ps.length).toBe(2); // page break
    expect(text(ps[0])).toContain("Dear");
    expect(text(ps[0])).toContain("one");
    expect(text(ps[0])).toContain("A");
    expect(text(ps[1])).toContain("End");
    expect(warnings).toEqual([]);
  });

  it("letter: letterhead on page 1, continuation + Page N on page 2, body clear of headers", async () => {
    const { buffer } = await resolvedToPdf({
      body: longBody(),
      letterhead: doc("LETTERHEAD NAME"),
      continuation: doc("CONTINUATION HDR"),
      style: style("letter", { letterhead: { blockId: "b", logo: null } }),
    });
    const ps = await pages(buffer);
    expect(ps.length).toBe(2);
    expect(text(ps[0])).toContain("LETTERHEAD NAME");
    expect(text(ps[0])).not.toContain("CONTINUATION HDR");
    expect(text(ps[0])).not.toContain("Page 1");
    expect(text(ps[1])).toContain("CONTINUATION HDR");
    expect(text(ps[1])).toContain("Page 2");
    expect(text(ps[1])).not.toContain("LETTERHEAD NAME");
    for (const p of ps) {
      const hdr = p.filter((i) => /LETTERHEAD|CONTINUATION|Page \d/.test(i.str));
      const body = p.filter((i) => i.str.startsWith("Body line"));
      const lowestHdr = Math.min(...hdr.map((i) => i.y));
      const highestBody = Math.max(...body.map((i) => i.y));
      expect(highestBody).toBeLessThan(lowestHdr);
    }
  });

  it("letter with pageNumbers none has no Page N and no footer number", async () => {
    const { buffer } = await resolvedToPdf({
      body: longBody(),
      letterhead: null,
      continuation: doc("CONTINUATION HDR"),
      style: style("letter", { pageNumbers: "none" }),
    });
    const ps = await pages(buffer);
    expect(text(ps[1])).toContain("CONTINUATION HDR");
    expect(ps.map(text).join(" ")).not.toMatch(/Page \d/);
  });

  it("letter: the number is in the header, never a footer", async () => {
    const { buffer } = await resolvedToPdf({
      body: longBody(),
      letterhead: null,
      continuation: null,
      style: style("letter"),
    });
    const ps = await pages(buffer);
    const num = ps[1].find((i) => i.str.includes("Page 2"))!;
    expect(num.y).toBeGreaterThan(600); // top of a 792pt page
  });

  it("filing: no letterhead, footer Page N on pages 2+ only", async () => {
    const { buffer } = await resolvedToPdf({
      body: longBody(),
      letterhead: doc("LETTERHEAD NAME"),
      continuation: doc("CONTINUATION HDR"),
      style: style("filing"),
    });
    const ps = await pages(buffer);
    expect(ps.length).toBe(2);
    expect(ps.map(text).join(" ")).not.toMatch(/LETTERHEAD|CONTINUATION/);
    expect(text(ps[0])).not.toMatch(/Page \d/);
    const num = ps[1].find((i) => i.str.includes("Page 2"))!;
    expect(num.y).toBeLessThan(100);
  });

  it("embeds the registry family for the chosen font", async () => {
    for (const key of ["times", "garamond"] as const) {
      const { buffer } = await resolvedToPdf({
        body: doc("Hello"),
        letterhead: null,
        continuation: null,
        style: style("letter", { font: key }),
      });
      const names = await fontNames(buffer);
      const family = FONTS[key].pdfFamily.replace(/ /g, "");
      expect(names.some((n) => n.includes(family))).toBe(true);
    }
  });

  it("warns for characters the font lacks and still produces a PDF", async () => {
    const { buffer, warnings } = await resolvedToPdf({
      body: doc("Client 王小明"),
      letterhead: null,
      continuation: null,
      style: style("letter", { font: "arial" }),
    });
    expect(warnings).toEqual(["Some characters can't be shown in Arial."]);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("renders the missing mark and a logo-only letterhead without throwing", async () => {
    const { buffer, warnings } = await resolvedToPdf({
      body: doc("[client name]", [{ type: "missing" }]),
      letterhead: null,
      continuation: null,
      style: style("letter", {
        letterhead: {
          blockId: null,
          logo: { bytes: png, contentType: "image/png", position: "center" },
        },
      }),
    });
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(warnings).toEqual([]);
  });

  it("logo null with a letterhead block is valid", async () => {
    const { buffer } = await resolvedToPdf({
      body: doc("Body"),
      letterhead: doc("LH"),
      continuation: null,
      style: style("letter", { letterhead: { blockId: "b", logo: null } }),
    });
    expect(text((await pages(buffer))[0])).toContain("LH");
  });
});

describe("line spacing", () => {
  it("scales the line gap with the spacing factor", async () => {
    const gap = async (s: PageStyle["lineSpacing"]) => {
      const { buffer } = await resolvedToPdf({
        body: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "word ".repeat(120) }] }],
        },
        letterhead: null,
        continuation: null,
        style: style("letter", { lineSpacing: s, pageNumbers: "none" }),
      });
      const ys = (await pages(buffer))[0].map((i) => i.y);
      return ys[0] - ys[1];
    };
    const single = await gap(1);
    const double = await gap(2);
    expect(single).toBeGreaterThan(13); // natural line height, not 1.0 x size
    expect(double / single).toBeGreaterThan(1.7);
    expect(double / single).toBeLessThan(2.3);
  });
});
