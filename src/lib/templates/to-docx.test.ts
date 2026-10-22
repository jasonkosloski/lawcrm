import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { resolvedToDocx } from "./to-docx";
import { renderFixture } from "./converters-fixture";
import {
  CELL_PAD_TWIPS,
  DEFAULT_DOCUMENT_STYLE,
  HEADER_DISTANCE_PT,
  HEADER_DISTANCE_TWIPS,
  resolvePageStyle,
  type PageStyle,
} from "./page-style";
import type { ResolvedDoc } from "./render";

const text = (t: string, marks?: { type: "missing" }[]): ResolvedDoc => ({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: t, ...(marks ? { marks } : {}) }] },
  ],
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

const letterStyle = (over: Partial<PageStyle> = {}): PageStyle => ({
  ...resolvePageStyle("letter", DEFAULT_DOCUMENT_STYLE, null),
  ...over,
});

async function build(input: {
  body?: ResolvedDoc;
  letterhead?: ResolvedDoc | null;
  continuation?: ResolvedDoc | null;
  style: PageStyle;
}) {
  const buf = await resolvedToDocx({
    body: input.body ?? text("Body"),
    letterhead: input.letterhead ?? null,
    continuation: input.continuation ?? null,
    style: input.style,
  });
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files);
  const read = async (n: string) => zip.file(n)!.async("string");
  const headers = await Promise.all(
    names.filter((n) => /^word\/header\d*\.xml$/.test(n)).map(read),
  );
  const footers = await Promise.all(
    names.filter((n) => /^word\/footer\d*\.xml$/.test(n)).map(read),
  );
  return {
    zip,
    names,
    doc: await read("word/document.xml"),
    styles: await read("word/styles.xml"),
    headers,
    footers,
  };
}

describe("resolvedToDocx", () => {
  it("writes a docx with text, a page break, a table, lists and highlight", async () => {
    const buf = await resolvedToDocx({
      body: renderFixture(),
      letterhead: null,
      continuation: null,
      style: letterStyle(),
    });
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("Dear ");
    expect(xml).toContain("<script>alert(1)</script>".replace(/</g, "&lt;").replace(/>/g, "&gt;"));
    expect(xml).toContain('<w:br w:type="page"/>');
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("<w:numPr>");
    expect(xml).toContain('<w:jc w:val="right"/>');
    expect(xml).toContain('<w:highlight w:val="yellow"/>');
    expect(xml).toContain("<w:b/>");
    expect(xml).toContain("<w:i/>");
    expect(xml).toContain("not on file");
  });

  it("writes the page size for letter and legal", async () => {
    const letter = await build({ style: letterStyle() });
    expect(letter.doc).toMatch(/<w:pgSz [^>]*w:w="12240"[^>]*w:h="15840"/);
    const legal = await build({ style: letterStyle({ paperSize: "legal" }) });
    expect(legal.doc).toMatch(/<w:pgSz [^>]*w:w="12240"[^>]*w:h="20160"/);
  });

  it("applies margins, defaults, and line spacing", async () => {
    const style = letterStyle({
      marginsIn: { top: 1, right: 1.25, bottom: 0.5, left: 2 },
      font: "arial",
      sizePt: 12,
      lineSpacing: 1.5,
      spaceAfterPt: 12,
    });
    const { doc, styles } = await build({ style });
    expect(doc).toContain('w:top="1440"');
    expect(doc).toContain('w:right="1800"');
    expect(doc).toContain('w:bottom="720"');
    expect(doc).toContain('w:left="2880"');
    expect(styles).toContain('w:ascii="Arial"');
    expect(styles).toContain('<w:sz w:val="24"/>');
    expect(styles).toContain('w:after="240"');
    expect(styles).toContain('w:line="360"');
    expect(styles).toContain('w:lineRule="auto"');
  });

  it("sizes headings from the body size, bold", async () => {
    const body: ResolvedDoc = {
      type: "doc",
      content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "H" }] }],
    };
    const { styles } = await build({ body, style: letterStyle({ sizePt: 12 }) });
    expect(styles).toContain('<w:sz w:val="36"/>');
  });

  it("letters: titlePg, letterhead on first page with logo, continuation header holds PAGE, footer none", async () => {
    const style = letterStyle({
      letterhead: {
        blockId: "b1",
        logo: { bytes: png, contentType: "image/png", position: "center" },
      },
      continuationBlockId: "c1",
      pageNumbers: "bottom_right",
    });
    const { doc, headers, footers, names } = await build({
      style,
      letterhead: text("ACME LAW FIRM"),
      continuation: text("Re: Smith matter"),
    });
    expect(doc).toContain("<w:titlePg/>");
    const first = headers.find((h) => h.includes("ACME LAW FIRM"))!;
    expect(first).toBeDefined();
    expect(first).toContain("<w:drawing>");
    expect(first).toContain('<w:jc w:val="center"/>');
    expect(first).not.toContain("PAGE");
    expect(names.some((n) => n.startsWith("word/media/"))).toBe(true);
    const cont = headers.find((h) => h.includes("Re: Smith matter"))!;
    expect(cont).toContain("PAGE");
    expect(cont).toContain('<w:jc w:val="right"/>');
    expect(footers.some((f) => f.includes("PAGE"))).toBe(false);
  });

  it("logo alone when the letterhead block is null", async () => {
    const style = letterStyle({
      letterhead: {
        blockId: null,
        logo: { bytes: png, contentType: "image/png", position: "left" },
      },
    });
    const { headers } = await build({ style });
    expect(headers.some((h) => h.includes("<w:drawing>"))).toBe(true);
  });

  it("filing + bottom_right: PAGE only in default footer, first footer empty, no headers", async () => {
    const style = resolvePageStyle(
      "filing",
      { ...DEFAULT_DOCUMENT_STYLE, pageNumbers: "bottom_right" },
      null,
    );
    const { doc, headers, footers } = await build({ style });
    expect(headers).toHaveLength(0);
    expect(doc).toContain("<w:titlePg/>");
    expect(footers.filter((f) => f.includes("PAGE"))).toHaveLength(1);
    expect(footers.filter((f) => !f.includes("PAGE"))).toHaveLength(1);
  });

  it("filing + none: no titlePg, no headers, no PAGE", async () => {
    const style = resolvePageStyle(
      "filing",
      { ...DEFAULT_DOCUMENT_STYLE, pageNumbers: "none" },
      null,
    );
    const { doc, headers, footers } = await build({ style });
    expect(doc).not.toContain("w:titlePg");
    expect(headers).toHaveLength(0);
    expect(footers.some((f) => f.includes("PAGE"))).toBe(false);
  });

  it("letter + none: no PAGE field anywhere", async () => {
    const { headers, footers } = await build({ style: letterStyle({ pageNumbers: "none" }) });
    expect([...headers, ...footers].some((x) => x.includes("PAGE"))).toBe(false);
  });

  it("letter with no letterhead or continuation: titlePg, PAGE only in default header", async () => {
    const { doc, headers, footers } = await build({
      style: letterStyle({ pageNumbers: "bottom_center" }),
    });
    expect(doc).toContain("<w:titlePg/>");
    expect(headers.filter((h) => h.includes("PAGE"))).toHaveLength(1);
    expect(footers.some((f) => f.includes("PAGE"))).toBe(false);
  });

  it("keeps a small logo at its own size (shrink-only)", async () => {
    const small = new Uint8Array(png);
    new DataView(small.buffer).setUint32(16, 96);
    new DataView(small.buffer).setUint32(20, 48);
    const style = letterStyle({
      letterhead: {
        blockId: null,
        logo: { bytes: small, contentType: "image/png", position: "left" },
      },
    });
    const { headers } = await build({ style });
    expect(headers.find((h) => h.includes("<w:drawing>"))).toContain(
      `<wp:extent cx="${96 * 9525}" cy="${48 * 9525}"/>`,
    );
  });

  it("skips an undecodable logo (no image, no blank box)", async () => {
    const style = letterStyle({
      letterhead: {
        blockId: "b1",
        logo: { bytes: new Uint8Array(40), contentType: "image/png", position: "left" },
      },
    });
    const { headers, names } = await build({ style, letterhead: text("LH") });
    expect(headers.some((h) => h.includes("<w:drawing>"))).toBe(false);
    expect(names.some((n) => n.startsWith("word/media/"))).toBe(false);
    expect(headers.some((h) => h.includes("LH"))).toBe(true);
  });

  it("highlights an archived-block marker in the letterhead", async () => {
    const style = letterStyle({ letterhead: { blockId: "b1", logo: null } });
    const { headers } = await build({
      style,
      letterhead: text("[X block — archived]", [{ type: "missing" }]),
    });
    expect(headers.find((h) => h.includes("archived"))).toContain('<w:highlight w:val="yellow"/>');
  });

  it("writes the shared header distance explicitly into the section", async () => {
    for (const style of [letterStyle(), resolvePageStyle("filing", DEFAULT_DOCUMENT_STYLE, null)]) {
      const { doc } = await build({ style });
      const pgMar = doc.match(/<w:pgMar [^>]*\/>/)![0];
      expect(pgMar).toContain(`w:header="${HEADER_DISTANCE_TWIPS}"`);
      expect(pgMar).toContain(`w:footer="${HEADER_DISTANCE_TWIPS}"`);
    }
    expect(HEADER_DISTANCE_TWIPS / 20).toBe(HEADER_DISTANCE_PT);
  });

  it("table cells: no space after, equal left/right padding", async () => {
    const { doc } = await build({
      body: {
        type: "doc",
        content: [
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableCell",
                    content: [{ type: "paragraph", content: [{ type: "text", text: "Cell" }] }],
                  },
                ],
              },
            ],
          },
          { type: "paragraph", content: [{ type: "text", text: "After" }] },
        ],
      } as ResolvedDoc,
      style: letterStyle(),
    });
    const tc = doc.match(/<w:tc>[\s\S]*?<\/w:tc>/)![0];
    expect(tc).toContain('<w:spacing w:after="0"/>');
    expect(tc).toMatch(new RegExp(`<w:(left|start) w:type="dxa" w:w="${CELL_PAD_TWIPS}"/>`));
    expect(tc).toMatch(new RegExp(`<w:(right|end) w:type="dxa" w:w="${CELL_PAD_TWIPS}"/>`));
    // Body paragraphs outside the table keep the document spacing.
    const after = doc.slice(doc.indexOf("</w:tbl>"));
    expect(after).not.toContain('w:after="0"');
  });
});
