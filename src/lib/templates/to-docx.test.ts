import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { resolvedToDocx } from "./to-docx";
import { captionFixture, mergedCaptionFixture, renderFixture } from "./converters-fixture";
import {
  CELL_PAD_TWIPS,
  DEFAULT_DOCUMENT_STYLE,
  HEADER_DISTANCE_PT,
  HEADER_DISTANCE_TWIPS,
  resolvePageStyle,
  type PageStyle,
} from "./page-style";
import { renderTemplate, type ResolvedDoc } from "./render";
import { SAMPLE_TEMPLATE_DATA } from "./catalog";
import type { ParagraphAttrs, TemplateDoc, TemplateMark } from "./schema";
import type { StyleValues } from "./paragraph-styles";

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
      styles: letterStyle().styles.map((x) =>
        x.key === "body"
          ? { ...x, values: { ...x.values, lineSpacing: "1.5", spaceAfterPt: 12 } }
          : x,
      ),
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

describe("resolvedToDocx tables", () => {
  const cells = (xml: string) => xml.match(/<w:tc>.*?<\/w:tc>/g) ?? [];

  it("fills the text width in the editor's column proportions", async () => {
    const { doc } = await build({ body: captionFixture(), style: letterStyle() });
    // Letter paper (12240 twips) less 1in margins each side = 9360.
    expect(doc).toContain('<w:tblW w:type="dxa" w:w="9360"/>');
    expect(doc).toContain('<w:tblLayout w:type="fixed"/>');
    expect(doc).toContain('<w:gridCol w:w="6240"/><w:gridCol w:w="3120"/>');
  });

  it("writes merges, vertical alignment and per-side borders", async () => {
    const { doc } = await build({ body: captionFixture(), style: letterStyle() });
    const tcs = cells(doc);
    expect(tcs).toHaveLength(7);
    const stamp = tcs[1];
    expect(stamp).toMatch(/<w:bottom w:val="none"/);
    const courtUse = tcs[3];
    expect(courtUse).toContain('<w:vAlign w:val="bottom"/>');
    expect(courtUse).toMatch(/<w:top w:val="none"/);
    expect(courtUse).toMatch(/<w:bottom w:val="single" w:color="000000" w:sz="12"/);
    const parties = tcs[2];
    expect(parties).toMatch(/<w:top w:val="single" w:color="000000" w:sz="12"/);
    expect(parties).toMatch(/<w:left w:val="single" w:color="000000" w:sz="4"/);
    const title = tcs[6];
    expect(title).toContain('<w:gridSpan w:val="2"/>');
    expect(title).toContain('<w:tcW w:type="dxa" w:w="9360"/>');
  });

  it("gives a fit table's unset columns a usable starting grid", async () => {
    const body: ResolvedDoc = {
      type: "doc",
      content: [
        {
          type: "table",
          attrs: { width: "fit" },
          content: [
            {
              type: "tableRow",
              content: ["a", "b", "c"].map((x) => ({
                type: "tableCell" as const,
                content: [
                  { type: "paragraph" as const, content: [{ type: "text" as const, text: x }] },
                ],
              })),
            },
          ],
        },
      ],
    };
    const { doc } = await build({ body, style: letterStyle() });
    expect(doc).toContain('<w:gridCol w:w="3120"/><w:gridCol w:w="3120"/><w:gridCol w:w="3120"/>');
    expect(doc).toContain('<w:tcW w:type="auto" w:w="0"/>');
  });

  it("sizes a table nested in a cell to that cell", async () => {
    const body: ResolvedDoc = {
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
                  content: [
                    {
                      type: "table",
                      content: [
                        {
                          type: "tableRow",
                          content: [{ type: "tableCell", content: [{ type: "paragraph" }] }],
                        },
                      ],
                    },
                  ],
                },
                { type: "tableCell", content: [{ type: "paragraph" }] },
              ],
            },
          ],
        },
      ],
    };
    const { doc } = await build({ body, style: letterStyle() });
    // Outer cell 4680 twips less 2 x 115 padding.
    expect(doc).toContain('<w:tblW w:type="dxa" w:w="4450"/>');
  });

  it("lets Word autofit a fit-to-content table", async () => {
    const body = captionFixture();
    const t = body.content![0];
    if (t.type === "table") t.attrs = { width: "fit" };
    const { doc } = await build({ body, style: letterStyle() });
    expect(doc).toContain('<w:tblLayout w:type="autofit"/>');
    expect(doc).toContain('<w:tblW w:type="auto" w:w="0"/>');
    // Set widths are kept as Word's starting grid (editor px x 15).
    expect(doc).toContain('<w:gridCol w:w="6000"/><w:gridCol w:w="3000"/>');
  });
});

describe("resolvedToDocx row spans", () => {
  it("fills a hole before a merged cell's continuation so Word keeps the columns", async () => {
    const cell = (text: string, rowspan?: number) => ({
      type: "tableCell" as const,
      ...(rowspan ? { attrs: { rowspan } } : {}),
      content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text }] }],
    });
    const body: ResolvedDoc = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            { type: "tableRow", content: [cell("A"), cell("B"), cell("C", 2)] },
            { type: "tableRow", content: [cell("D")] },
          ],
        },
      ],
    };
    const { doc } = await build({ body, style: letterStyle() });
    const row2 = (doc.match(/<w:tr>.*?<\/w:tr>/g) ?? [])[1];
    const cells = row2.match(/<w:tc>.*?<\/w:tc>/g) ?? [];
    expect(cells).toHaveLength(3);
    expect(cells[0]).toContain(">D<");
    expect(cells[1]).not.toContain("vMerge");
    expect(cells[2]).toContain("vMerge");
  });

  it("merges down with vMerge, the continuation keeping the column", async () => {
    const { doc } = await build({ body: mergedCaptionFixture(), style: letterStyle() });
    const rows = doc.match(/<w:tr>.*?<\/w:tr>/g) ?? [];
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain('<w:vMerge w:val="restart"/>');
    expect(rows[0]).toContain('<w:vAlign w:val="bottom"/>');
    // Row 2 has the parties cell plus Word's continuation cell.
    const cells = rows[1].match(/<w:tc>.*?<\/w:tc>/g) ?? [];
    expect(cells).toHaveLength(2);
    expect(cells[1]).toMatch(/<w:vMerge(\/>| w:val="continue"\/>)/);
  });
});

describe("resolvedToDocx small caps", () => {
  it("uses Word's small caps", async () => {
    const body: ResolvedDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Plaintiff", marks: [{ type: "smallCaps" }] }],
        },
      ],
    };
    const { doc } = await build({ body, style: letterStyle() });
    expect(doc).toMatch(/<w:smallCaps\/>.*Plaintiff/);
  });
});

describe("resolvedToDocx paragraph styles", () => {
  const render = (content: TemplateDoc["content"], style: PageStyle) =>
    renderTemplate(
      { type: "doc", content },
      { data: SAMPLE_TEMPLATE_DATA, blocks: new Map(), styles: style.styles },
    ).doc;
  const para = (t: string, attrs?: ParagraphAttrs, marks?: TemplateMark[]) => ({
    type: "paragraph" as const,
    ...(attrs ? { attrs } : {}),
    content: [{ type: "text" as const, text: t, ...(marks ? { marks } : {}) }],
  });
  const styled = async (
    content: TemplateDoc["content"],
    edit?: (key: string, v: StyleValues) => StyleValues,
  ) => {
    const base = letterStyle();
    const style = edit
      ? { ...base, styles: base.styles.map((s) => ({ ...s, values: edit(s.key, s.values) })) }
      : base;
    return build({ body: render(content, style) as ResolvedDoc, style });
  };
  const styleXml = (xml: string, id: string) =>
    xml.match(new RegExp(`<w:style [^>]*w:styleId="${id}".*?</w:style>`))?.[0] ?? "";

  it("Normal carries Body; custom styles keep the firm's name; headings have outline levels", async () => {
    const { styles } = await styled([para("x")]);
    expect(styleXml(styles, "Normal")).toContain('<w:name w:val="Normal"/>');
    expect(styleXml(styles, "caption")).toContain('<w:name w:val="Caption"/>');
    expect(styleXml(styles, "Heading1")).toContain('<w:outlineLvl w:val="0"/>');
    expect(styleXml(styles, "Heading2")).toContain('<w:outlineLvl w:val="1"/>');
    expect(styleXml(styles, "Heading3")).toContain('<w:outlineLvl w:val="2"/>');
    expect(styleXml(styles, "Heading1")).toContain("<w:keepNext/>");
    expect(styleXml(styles, "Title")).toContain("<w:caps/>");
    expect(styleXml(styles, "blockquote")).toContain('w:left="720"');
    expect(styles.match(/w:styleId="Heading1"/g)).toHaveLength(1);
  });

  it("a paragraph references its style and writes only direct settings", async () => {
    const { doc } = await styled([
      para("a", { style: "caption" }),
      para("b", { style: "caption", spaceAfterPt: 6, textAlign: "right" }),
      para("c", { style: "heading1" }),
      para("d"),
    ]);
    const pprs = [...doc.matchAll(/<w:p>(<w:pPr>.*?<\/w:pPr>)?/g)].map((m) => m[1] ?? "");
    expect(pprs[0]).toBe('<w:pPr><w:pStyle w:val="caption"/></w:pPr>');
    expect(pprs[1]).toContain('<w:pStyle w:val="caption"/>');
    expect(pprs[1]).toContain('w:after="120"');
    expect(pprs[1]).toContain('<w:jc w:val="right"/>');
    expect(pprs[2]).toBe('<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>');
    expect(pprs[3]).toBe("");
  });

  it("writes exact, hanging and page flow in a style", async () => {
    const { styles } = await styled([para("x")], (key, v) =>
      key === "caption"
        ? {
            ...v,
            lineSpacing: { exactPt: 14 },
            firstLine: { kind: "hanging", in: 0.5 },
            indentLeftIn: 1,
            keepWithNext: true,
            keepLinesTogether: true,
            pageBreakBefore: true,
          }
        : v,
    );
    const x = styleXml(styles, "caption");
    expect(x).toContain('w:lineRule="exact"');
    expect(x).toContain('w:line="280"');
    expect(x).toContain('w:hanging="720"');
    expect(x).toContain('w:left="1440"');
    expect(x).toContain("<w:keepNext/>");
    expect(x).toContain("<w:keepLines/>");
    expect(x).toContain("<w:pageBreakBefore/>");
  });

  it("direct settings override: explicit zero, first line, exact spacing", async () => {
    const { doc } = await styled([
      para("a", {
        style: "blockquote",
        indentLeftIn: 0,
        firstLine: { kind: "indent", in: 0.5 },
        spaceBeforePt: 0,
        lineSpacing: { exactPt: 14 },
        keepWithNext: true,
      }),
    ]);
    expect(doc).toContain('w:left="0"');
    expect(doc).toContain('w:firstLine="720"');
    expect(doc).toContain('w:before="0"');
    expect(doc).toContain('w:lineRule="exact"');
    expect(doc).toContain('w:line="280"');
    expect(doc).toContain("<w:keepNext/>");
  });

  it("marks: all caps and font size", async () => {
    const { doc } = await styled([
      para("a", undefined, [{ type: "allCaps" }, { type: "fontSize", attrs: { pt: 9 } }]),
    ]);
    expect(doc).toContain("<w:caps/>");
    expect(doc).toContain('<w:sz w:val="18"/>');
  });

  it("exact 8pt line spacing with 12pt text produces a valid file", async () => {
    const { zip, styles } = await styled([para("a", { style: "caption" })], (key, v) =>
      key === "caption" ? { ...v, sizePt: 12, lineSpacing: { exactPt: 8 } } : v,
    );
    expect(styleXml(styles, "caption")).toContain('w:line="160"');
    expect(zip.file("word/document.xml")).toBeTruthy();
  });

  it("table cell paragraphs keep zero space after unless they set their own", async () => {
    const cell = (p: ReturnType<typeof para>) => ({
      type: "table" as const,
      content: [
        { type: "tableRow" as const, content: [{ type: "tableCell" as const, content: [p] }] },
      ],
    });
    const { doc } = await styled([cell(para("a")), cell(para("b", { spaceAfterPt: 6 }))]);
    const pprs = [...doc.matchAll(/<w:p>(<w:pPr>.*?<\/w:pPr>)?/g)].map((m) => m[1] ?? "");
    expect(pprs[0]).toContain('w:after="0"');
    expect(pprs[1]).toContain('w:after="120"');
  });

  it("list items take their paragraph style and add their indent to the list indent", async () => {
    const item = (p: ReturnType<typeof para>) => ({ type: "listItem" as const, content: [p] });
    const { doc } = await styled([
      {
        type: "bulletList" as const,
        content: [
          item(para("a", { style: "blockquote" })),
          item(para("b", { spaceAfterPt: 6, indentLeftIn: 0.5 })),
        ],
      },
    ]);
    const pprs = [...doc.matchAll(/<w:p>(<w:pPr>.*?<\/w:pPr>)?/g)].map((m) => m[1] ?? "");
    expect(pprs[0]).toContain('<w:pStyle w:val="blockquote"/>');
    expect(pprs[0]).toContain('w:left="1440"');
    expect(pprs[0]).toContain('w:hanging="360"');
    expect(pprs[1]).toContain('w:after="120"');
    expect(pprs[1]).toContain('w:left="1440"');
    expect(pprs[1]).toContain("<w:numPr>");
  });
});
