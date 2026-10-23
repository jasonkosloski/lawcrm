import { PDFDocument, PDFName, PDFDict, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { FONTS } from "./fonts";
import { captionFixture, mergedCaptionFixture, renderFixture } from "./converters-fixture";
import {
  DEFAULT_DOCUMENT_STYLE,
  HEADER_DISTANCE_PT,
  resolvePageStyle,
  type PageStyle,
} from "./page-style";
import { defaultParagraphStyles } from "./paragraph-styles";
import type { ResolvedBlock, ResolvedDoc, ResolvedTableCell } from "./render";
import type { ResolvedParagraphStyle } from "./resolve-styles";
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

const stubPng = (() => {
  const b = new Uint8Array(33);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x89504e47);
  v.setUint32(12, 0x49484452);
  v.setUint32(16, 600);
  v.setUint32(20, 100);
  return b;
})();

const realPng = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const realJpeg = new Uint8Array(
  Buffer.from(
    "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAgDAREAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDzqvjj+kT/2Q==",
    "base64",
  ),
);

const imageCount = async (buf: Buffer) => {
  const pdf = await PDFDocument.load(buf);
  let n = 0;
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFRawStream ? obj.dict : obj instanceof PDFDict ? obj : null;
    if (dict?.get(PDFName.of("Subtype")) === PDFName.of("Image")) n++;
  }
  return n;
};

const style = (kind: "letter" | "filing", over: Partial<PageStyle> = {}): PageStyle => ({
  ...resolvePageStyle(kind, DEFAULT_DOCUMENT_STYLE, null),
  ...over,
});

describe("paper size", () => {
  const firstPage = async (over: Partial<PageStyle>) => {
    const { buffer } = await resolvedToPdf({
      body: doc("Body"),
      letterhead: null,
      continuation: null,
      style: style("filing", over),
    });
    return (await PDFDocument.load(buffer)).getPage(0).getSize();
  };
  it("letter is 612 x 792 pt", async () => {
    expect(await firstPage({})).toEqual({ width: 612, height: 792 });
  });
  it("legal is 612 x 1008 pt", async () => {
    expect(await firstPage({ paperSize: "legal" })).toEqual({ width: 612, height: 1008 });
  });
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
          logo: { bytes: stubPng, contentType: "image/png", position: "center" },
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

describe("logo embedding", () => {
  const withLogo = (bytes: Uint8Array, contentType: "image/png" | "image/jpeg", block: boolean) =>
    resolvedToPdf({
      body: doc("Body"),
      letterhead: block ? doc("LH") : null,
      continuation: null,
      style: style("letter", {
        letterhead: {
          blockId: block ? "b" : null,
          logo: { bytes, contentType, position: "right" },
        },
      }),
    });

  it("embeds a real PNG and JPEG as image XObjects, alone or with a block", async () => {
    for (const block of [false, true]) {
      const a = await withLogo(realPng, "image/png", block);
      const b = await withLogo(realJpeg, "image/jpeg", block);
      expect(await imageCount(a.buffer), `png block=${block}`).toBeGreaterThan(0);
      expect(await imageCount(b.buffer), `jpeg block=${block}`).toBeGreaterThan(0);
      expect(a.warnings).toEqual([]);
    }
  });

  it("skips an undecodable logo and warns", async () => {
    const bad = new Uint8Array(40); // no PNG signature
    const r = await withLogo(bad, "image/png", true);
    expect(await imageCount(r.buffer)).toBe(0);
    expect(r.warnings).toEqual(["Logo couldn't be loaded."]);
    expect(text((await pages(r.buffer))[0])).toContain("LH");
  });

  it("stub PNG (valid header, undecodable body) is accepted without throwing", async () => {
    const r = await withLogo(stubPng, "image/png", false);
    expect(r.buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("glyph fallback", () => {
  it("does not warn for accented Latin in Garamond", async () => {
    const r = await resolvedToPdf({
      body: doc("naïve café"),
      letterhead: null,
      continuation: null,
      style: style("letter", { font: "garamond" }),
    });
    expect(r.warnings).toEqual([]);
  });
});

describe("header placement follows Word", () => {
  const firstBodyY = (p: Item[]) =>
    Math.max(...p.filter((i) => i.str.startsWith("Body line")).map((i) => i.y));

  it("body starts at the top margin on every page when the header is shorter", async () => {
    const filing = await resolvedToPdf({
      body: longBody(),
      letterhead: null,
      continuation: null,
      style: style("filing", { pageNumbers: "none" }),
    });
    const ref = await pages(filing.buffer);
    const y0 = firstBodyY(ref[0]);
    expect(firstBodyY(ref[1])).toBeCloseTo(y0, 1);

    const letter = await resolvedToPdf({
      body: longBody(),
      letterhead: doc("LH NAME"),
      continuation: doc("CONT HDR"),
      style: style("letter", {
        letterhead: { blockId: "b", logo: null },
        pageNumbers: "none",
      }),
    });
    const ps = await pages(letter.buffer);
    expect(ps.length).toBeGreaterThanOrEqual(2);
    expect(firstBodyY(ps[0])).toBeCloseTo(y0, 1);
    expect(firstBodyY(ps[1])).toBeCloseTo(y0, 1);
    // Headers start at the header distance (35.4 pt), 36.6 pt above the body.
    const lh = ps[0].find((i) => i.str.includes("LH NAME"))!;
    const ch = ps[1].find((i) => i.str.includes("CONT HDR"))!;
    expect(lh.y - y0).toBeCloseTo(72 - HEADER_DISTANCE_PT, 1);
    expect(ch.y - y0).toBeCloseTo(72 - HEADER_DISTANCE_PT, 1);
  });

  it("a header taller than the gap pushes the body down", async () => {
    const ref = await pages(
      (
        await resolvedToPdf({
          body: longBody(),
          letterhead: null,
          continuation: null,
          style: style("filing", { pageNumbers: "none" }),
        })
      ).buffer,
    );
    const ps = await pages(
      (
        await resolvedToPdf({
          body: longBody(),
          letterhead: null,
          continuation: doc("CONT HDR"),
          style: style("letter"), // continuation + "Page N": two lines with space after
        })
      ).buffer,
    );
    expect(firstBodyY(ps[1])).toBeLessThan(firstBodyY(ref[0]) - 1);
  });
});

describe("hyphenation", () => {
  it("never splits a long word with a hyphen (Word doesn't)", async () => {
    const word = "Supercalifragilisticexpialidocious";
    const { buffer } = await resolvedToPdf({
      body: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: `${word} `.repeat(40).trim() }] },
        ],
      },
      letterhead: null,
      continuation: null,
      style: style("letter", { pageNumbers: "none" }),
    });
    const all = (await pages(buffer)).map(text).join(" ");
    expect(all).not.toContain("-");
    expect(
      all
        .split(/\s+/)
        .filter(Boolean)
        .every((w) => w === word),
    ).toBe(true);
  });
});

describe("logo size", () => {
  it("treats image pixels as 96 dpi: a 200x60 PNG is 150 pt wide", async () => {
    const sharp = (await import("sharp")).default;
    const png = new Uint8Array(
      await sharp({ create: { width: 200, height: 60, channels: 3, background: "#336699" } })
        .png()
        .toBuffer(),
    );
    const { buffer } = await resolvedToPdf({
      body: doc("Body"),
      letterhead: null,
      continuation: null,
      style: style("letter", {
        letterhead: {
          blockId: null,
          logo: { bytes: png, contentType: "image/png", position: "left" },
        },
      }),
    });
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), verbosity: 0 }).promise;
    const ops = await (await pdf.getPage(1)).getOperatorList();
    let last: number[] | null = null;
    let size: number[] | null = null;
    ops.fnArray.forEach((fn, i) => {
      if (fn === pdfjs.OPS.transform) last = ops.argsArray[i] as number[];
      if (fn === pdfjs.OPS.paintImageXObject && last) size = [last[0], Math.abs(last[3])];
    });
    expect(size).not.toBeNull();
    expect(size![0]).toBeCloseTo(150, 1);
    expect(size![1]).toBeCloseTo(45, 1);
  });
});

describe("Page N line", () => {
  it("uses the body line height", async () => {
    // Double spacing, no space after: continuation + page line (two lines)
    // are taller than the header gap, so the body follows them directly and
    // every line pitch should be the body's.
    const { buffer } = await resolvedToPdf({
      body: longBody(),
      letterhead: null,
      continuation: doc("CONT HDR"),
      style: style("letter", { spaceAfterPt: 0, lineSpacing: 2 }),
    });
    const p2 = (await pages(buffer))[1];
    const ch = p2.find((i) => i.str.includes("CONT HDR"))!;
    const num = p2.find((i) => i.str.includes("Page 2"))!;
    const body = p2.filter((i) => i.str.startsWith("Body line")).map((i) => i.y);
    const pitch = body[0] - body[1];
    expect(ch.y - num.y).toBeCloseTo(pitch, 1);
    expect(num.y - body[0]).toBeCloseTo(pitch, 1);
  });
});

describe("resolvedToPdf tables", () => {
  type Placed = { str: string; x: number; y: number };
  async function placed(buf: Buffer): Promise<Placed[]> {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
    const tc = await (await pdf.getPage(1)).getTextContent();
    return tc.items
      .filter((it): it is typeof it & { str: string } => "str" in it && it.str.trim() !== "")
      .map((it) => {
        const m = (it as { transform: number[] }).transform;
        return { str: it.str, x: m[4], y: m[5] };
      });
  }
  const find = (items: Placed[], s: string) => {
    const hit = items.find((i) => i.str.includes(s));
    if (!hit) throw new Error(`"${s}" not on the page: ${items.map((i) => i.str).join(" | ")}`);
    return hit;
  };
  const render = async (body: ResolvedDoc) =>
    resolvedToPdf({ body, letterhead: null, continuation: null, style: style("filing") });
  const cell = (attrs: ResolvedTableCell["attrs"], ...lines: string[]): ResolvedTableCell => ({
    type: "tableCell",
    attrs,
    content: lines.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
  });
  const oneRow = (width: "fit" | undefined, ...cells: ResolvedTableCell[]): ResolvedDoc => ({
    type: "doc",
    content: [
      {
        type: "table",
        ...(width ? { attrs: { width } } : {}),
        content: [{ type: "tableRow", content: cells }],
      },
    ],
  });

  it("draws the caption with ballot boxes from the symbol fallback and no warnings", async () => {
    const { buffer, warnings } = await render(captionFixture());
    expect(warnings).toEqual([]);
    expect((await fontNames(buffer)).some((n) => n.includes("DejaVuSans"))).toBe(true);
    const items = await placed(buffer);
    expect(items.map((i) => i.str).join(" ")).toContain("☒");
  });

  it("splits a full-width table in the editor's proportions", async () => {
    const items = await placed((await render(captionFixture())).buffer);
    // 1in margins: text width 468pt; column 2 starts at 72 + 2/3 * 468.
    const pad = 5.75;
    expect(find(items, "Attorney").x).toBeCloseTo(72 + 0.5 + pad, 0);
    expect(find(items, "Case Number").x).toBeCloseTo(72 + 312 + pad, 0);
  });

  it("centres the merged title across both columns", async () => {
    const items = await placed((await render(captionFixture())).buffer);
    const title = find(items, "MOTION");
    expect(title.x).toBeGreaterThan(200);
    expect(title.x).toBeLessThan(306);
  });

  it("aligns cell content to the bottom or middle of the row", async () => {
    const tall = cell({}, "one", "two", "three");
    const bottom = await placed(
      (await render(oneRow(undefined, tall, cell({ verticalAlign: "bottom" }, "low")))).buffer,
    );
    expect(find(bottom, "low").y).toBeCloseTo(find(bottom, "three").y, 0);
    const middle = await placed(
      (await render(oneRow(undefined, tall, cell({ verticalAlign: "middle" }, "mid")))).buffer,
    );
    expect(find(middle, "mid").y).toBeCloseTo(find(middle, "two").y, 0);
    const top = await placed((await render(oneRow(undefined, tall, cell({}, "high")))).buffer);
    expect(find(top, "high").y).toBeCloseTo(find(top, "one").y, 0);
  });

  it("keeps a table nested in a cell inside that cell", async () => {
    const nested: ResolvedTableCell = {
      type: "tableCell",
      content: [
        {
          type: "table",
          content: [{ type: "tableRow", content: [cell({}, "inner-a"), cell({}, "inner-b")] }],
        },
      ],
    };
    const items = await placed(
      (await render(oneRow(undefined, nested, cell({}, "outer-right")))).buffer,
    );
    // The outer cells split 468pt at 72 + 234; the nested halves fit in the first.
    expect(find(items, "inner-b").x).toBeLessThan(find(items, "outer-right").x);
    expect(find(items, "inner-b").x).toBeCloseTo(72 + 0.5 + 5.75 + (234 - 11.5 - 3) / 2 + 5.75, -1);
  });

  it("measures fallback glyphs in the font that draws them", async () => {
    const items = await placed(
      (await render(oneRow("fit", cell({}, "☐☐☐☐☐☐☐☐ County"), cell({}, "next")))).buffer,
    );
    // Sized wide enough: the boxes and "County" stay on one line.
    const all = items.filter((i) => /County|☐/.test(i.str));
    expect(new Set(all.map((i) => Math.round(i.y))).size).toBe(1);
  });

  it("shrinks a fit table to its content", async () => {
    const full = await placed(
      (await render(oneRow(undefined, cell({}, "Div."), cell({}, "Ctrm.")))).buffer,
    );
    const fit = await placed(
      (await render(oneRow("fit", cell({}, "Div."), cell({}, "Ctrm.")))).buffer,
    );
    expect(find(full, "Ctrm").x).toBeGreaterThan(300);
    // "Div." at 12pt is ~24pt wide, plus padding and rules.
    expect(find(fit, "Ctrm").x).toBeGreaterThan(find(fit, "Div").x + 20);
    expect(find(fit, "Ctrm").x).toBeLessThan(find(fit, "Div").x + 50);
  });
});

describe("resolvedToPdf row spans", () => {
  type Placed = { str: string; x: number; y: number };
  async function placed(buf: Buffer): Promise<Placed[]> {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
    const tc = await (await pdf.getPage(1)).getTextContent();
    return tc.items
      .filter((it): it is typeof it & { str: string } => "str" in it && it.str.trim() !== "")
      .map((it) => {
        const m = (it as { transform: number[] }).transform;
        return { str: it.str, x: m[4], y: m[5] };
      });
  }
  const find = (items: Placed[], s: string) => {
    const hit = items.find((i) => i.str.includes(s));
    if (!hit) throw new Error(`"${s}" not on the page: ${items.map((i) => i.str).join(" | ")}`);
    return hit;
  };
  const render = async (body: ResolvedDoc) =>
    (await resolvedToPdf({ body, letterhead: null, continuation: null, style: style("filing") }))
      .buffer;
  const para = (text: string) => ({
    type: "paragraph" as const,
    content: [{ type: "text" as const, text }],
  });

  it("draws two rows beside one merged cell", async () => {
    const body: ResolvedDoc = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [para("left-one")] },
                {
                  type: "tableCell",
                  attrs: { rowspan: 2, verticalAlign: "bottom" },
                  content: [para("right-merged")],
                },
              ],
            },
            { type: "tableRow", content: [{ type: "tableCell", content: [para("left-two")] }] },
          ],
        },
      ],
    };
    const items = await placed(await render(body));
    const one = find(items, "left-one");
    const two = find(items, "left-two");
    const right = find(items, "right-merged");
    expect(two.y).toBeLessThan(one.y);
    expect(two.x).toBeCloseTo(one.x, 0);
    // Right column, bottom-aligned to the second row's line.
    expect(right.x).toBeGreaterThan(300);
    expect(right.y).toBeCloseTo(two.y, 0);
  });

  it("lays out the merged caption: court-use box beside court and parties", async () => {
    const items = await placed(await render(mergedCaptionFixture()));
    const court = find(items, "County Court");
    const defendant = find(items, "Defendant");
    const box = find(items, "COURT USE ONLY");
    const caseNo = find(items, "Case Number");
    expect(box.x).toBeGreaterThan(384);
    // Bottom of the merged box lines up with the last line of the parties.
    expect(box.y).toBeCloseTo(defendant.y, 0);
    expect(box.y).toBeLessThan(court.y);
    // The next band starts below both.
    expect(caseNo.y).toBeLessThan(defendant.y);
    expect(find(items, "MOTION").y).toBeLessThan(caseNo.y);
  });
});

describe("resolvedToPdf small caps", () => {
  it("draws lowercase as smaller capitals", async () => {
    const { buffer } = await resolvedToPdf({
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Plaintiff", marks: [{ type: "smallCaps" }] }],
          },
        ],
      },
      letterhead: null,
      continuation: null,
      style: style("filing"),
    });
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), verbosity: 0 }).promise;
    const items = (await (await pdf.getPage(1)).getTextContent()).items
      .filter((it): it is typeof it & { str: string } => "str" in it && it.str.trim() !== "")
      .map((it) => ({ str: it.str, size: (it as { transform: number[] }).transform[0] }));
    expect(items.map((i) => i.str).join("")).toBe("PLAINTIFF");
    const big = items.find((i) => i.str === "P")!;
    const small = items.find((i) => i.str === "LAINTIFF")!;
    expect(small.size / big.size).toBeCloseTo(0.8, 2);
  });
});

describe("resolvedToPdf paragraph styles", () => {
  const body: ResolvedParagraphStyle = {
    ...defaultParagraphStyles({ fontSizeHalfPt: 24, lineSpacing: "single", spaceAfterPt: 0 })[0]
      .values,
    key: "body",
    known: true,
  };
  type Raw = { str: string; x: number; y: number; size: number };
  const rawItems = async (buf: Buffer, page = 1): Promise<Raw[]> => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
    const tc = await (await pdf.getPage(page)).getTextContent();
    return tc.items
      .filter((it): it is typeof it & { str: string } => "str" in it && it.str.trim() !== "")
      .map((it) => {
        const t = (it as { transform: number[] }).transform;
        return { str: it.str, x: t[4], y: t[5], size: t[0] };
      });
  };
  const p = (
    t: string,
    over: Partial<ResolvedParagraphStyle> = {},
    extra: {
      attrs?: object;
      marks?: { type: "allCaps" | "fontSize"; attrs?: { pt: number } }[];
    } = {},
  ): ResolvedBlock =>
    ({
      type: "paragraph",
      attrs: { ...extra.attrs, resolved: { ...body, ...over } },
      content: [{ type: "text", text: t, ...(extra.marks ? { marks: extra.marks } : {}) }],
    }) as ResolvedBlock;
  const render = async (content: ResolvedBlock[], over: Partial<PageStyle> = {}) =>
    (
      await resolvedToPdf({
        body: { type: "doc", content },
        letterhead: null,
        continuation: null,
        style: style("filing", { pageNumbers: "none", ...over }),
      })
    ).buffer;
  const at = (items: Raw[], s: string) => items.find((i) => i.str.startsWith(s))!;
  const LONG = "word ".repeat(80).trim();

  it("space before moves the paragraph down", async () => {
    const a = at(await rawItems(await render([p("Alpha")])), "Alpha");
    const b = at(await rawItems(await render([p("Alpha", { spaceBeforePt: 24 })])), "Alpha");
    expect(a.y - b.y).toBeCloseTo(24, 1);
  });

  it("left indent shifts x by 72", async () => {
    const a = at(await rawItems(await render([p("Alpha")])), "Alpha");
    const b = at(await rawItems(await render([p("Alpha", { indentLeftIn: 1 })])), "Alpha");
    expect(b.x - a.x).toBeCloseTo(72, 1);
  });

  it("first-line indent shifts only the first line", async () => {
    const plain = await rawItems(await render([p(LONG)]));
    const ind = await rawItems(await render([p(LONG, { firstLine: { kind: "indent", in: 0.5 } })]));
    expect(ind[0].x - plain[0].x).toBeCloseTo(36, 1);
    expect(ind[1].x).toBeCloseTo(plain[1].x, 1);
  });

  it("hanging indent: first line at the margin, the rest 36pt in", async () => {
    const plain = await rawItems(await render([p(LONG)]));
    const h = await rawItems(
      await render([p(LONG, { indentLeftIn: 0.5, firstLine: { kind: "hanging", in: 0.5 } })]),
    );
    expect(h[0].x).toBeCloseTo(plain[0].x, 1);
    expect(h[1].x - plain[1].x).toBeCloseTo(36, 1);
  });

  it("a leading hard break still gets the first-line indent", async () => {
    const para = {
      type: "paragraph",
      attrs: { resolved: { ...body, firstLine: { kind: "indent", in: 0.5 } } },
      content: [{ type: "hardBreak" }, { type: "text", text: "After break" }],
    } as ResolvedBlock;
    const a = await rawItems(await render([para]));
    const b = await rawItems(await render([p("After break")]));
    expect(a[0].x - b[0].x).toBeCloseTo(0, 1); // second line is not indented
    const first = await rawItems(await render([p("x"), para]));
    expect(first.length).toBeGreaterThan(0);
  });

  it("exact 24pt line spacing gives 24pt between baselines", async () => {
    const it = await rawItems(await render([p(LONG, { lineSpacing: { exactPt: 24 } })]));
    expect(it[0].y - it[1].y).toBeCloseTo(24, 1);
  });

  it("exact 8pt with 12pt text renders without throwing", async () => {
    const buf = await render([p(LONG, { lineSpacing: { exactPt: 8 } })]);
    const it = await rawItems(buf);
    expect(it[0].y - it[1].y).toBeCloseTo(8, 1);
  });

  it("page break before starts page 2", async () => {
    const buf = await render([p("First"), p("Second", { pageBreakBefore: true })]);
    expect((await rawItems(buf, 2))[0].str).toBe("Second");
  });

  it("all caps (style or mark) renders uppercase", async () => {
    const a = await rawItems(await render([p("hello", { allCaps: true })]));
    const b = await rawItems(await render([p("hello", {}, { marks: [{ type: "allCaps" }] })]));
    expect(a[0].str).toBe("HELLO");
    expect(b[0].str).toBe("HELLO");
  });

  it("keep with next moves a heading to the page its paragraph starts on", async () => {
    // 45 filler lines leave room for the heading but not for its paragraph.
    const doc = (keep: boolean) => [
      ...Array.from({ length: 45 }, (_, i) => p(`Filler ${i}`)),
      p("Heading text", { sizePt: 18, bold: true, keepWithNext: keep }),
      p("Following paragraph"),
    ];
    const pageText = async (buf: Buffer, n: number) =>
      (await rawItems(buf, n)).map((i) => i.str).join(" ");
    const kept = await render(doc(true));
    expect(await pageText(kept, 1)).not.toContain("Heading text");
    expect(await pageText(kept, 2)).toContain("Heading text");
    expect(await pageText(kept, 2)).toContain("Following paragraph");
    const free = await render(doc(false));
    expect(await pageText(free, 1)).toContain("Heading text");
    expect(await pageText(free, 2)).not.toContain("Heading text");
  });

  it("a bold style draws its runs in the bold face", async () => {
    const h = await render([p("Heading text", { bold: true })]);
    const r = await render([p("Heading text")]);
    expect((await fontNames(h)).some((n) => /Bold/i.test(n))).toBe(true);
    expect((await fontNames(r)).some((n) => /Bold/i.test(n))).toBe(false);
  });

  it("a font size mark renders at that size", async () => {
    const it = await rawItems(
      await render([p("tiny", {}, { marks: [{ type: "fontSize", attrs: { pt: 9 } }] })]),
    );
    expect(at(it, "tiny").size).toBeCloseTo(9, 1);
  });

  it("keep lines together moves a paragraph that would split to the next page", async () => {
    const filler = Array.from({ length: 44 }, (_, i) => p(`Filler ${i}`));
    const split = await render([...filler, p("word ".repeat(90).trim())]);
    const kept = await render([
      ...filler,
      p("word ".repeat(90).trim(), { keepLinesTogether: true }),
    ]);
    const onPage1 = async (buf: Buffer) => (await rawItems(buf, 1)).map((i) => i.str).join(" ");
    expect(await onPage1(split)).toContain("word");
    expect(await onPage1(kept)).not.toContain("word");
  });

  it("fit-table width uses the resolved size", async () => {
    const tbl = (size: number): ResolvedBlock =>
      ({
        type: "table",
        attrs: { width: "fit" },
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [p("Narrow", { sizePt: size })] },
              { type: "tableCell", content: [p("X", { sizePt: size })] },
            ],
          },
        ],
      }) as unknown as ResolvedBlock;
    const small = at(await rawItems(await render([tbl(10)])), "X");
    const big = at(await rawItems(await render([tbl(24)])), "X");
    expect(big.x).toBeGreaterThan(small.x + 20);
  });

  it("list items add their paragraph indent to the list indent and mark at their size", async () => {
    const list = (over: Partial<ResolvedParagraphStyle>): ResolvedBlock =>
      ({
        type: "bulletList",
        content: [{ type: "listItem", content: [p("Item", over)] }],
      }) as ResolvedBlock;
    const a = await rawItems(await render([list({})]));
    const b = await rawItems(await render([list({ indentLeftIn: 0.5, sizePt: 20 })]));
    expect(at(b, "Item").x - at(a, "Item").x).toBeCloseTo(36, 1);
    expect(at(b, "•").size).toBeCloseTo(20, 1);
  });

  it("table cells keep space after 0 unless set directly", async () => {
    const cellDoc = (attrs: object): ResolvedBlock =>
      ({
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [
                  p("One", { spaceAfterPt: 30 }, { attrs }),
                  p("Two", { spaceAfterPt: 30 }),
                ],
              },
            ],
          },
        ],
      }) as unknown as ResolvedBlock;
    const gap = async (attrs: object) => {
      const it = await rawItems(await render([cellDoc(attrs)]));
      return at(it, "One").y - at(it, "Two").y;
    };
    const zero = await gap({});
    expect(zero).toBeLessThan(20);
    expect((await gap({ spaceAfterPt: 30 })) - zero).toBeCloseTo(30, 1);
  });
});
