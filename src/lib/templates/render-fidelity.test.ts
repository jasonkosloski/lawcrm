/**
 * Review Focus 1: existing templates must look identical once the render
 * engine resolves paragraph styles. These literals were recorded from the
 * code BEFORE the change (headings were `heading` nodes) and must not move.
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { SAMPLE_TEMPLATE_DATA } from "./catalog";
import { renderTemplate } from "./render";
import { renderFixture } from "./converters-fixture";
import { DEFAULT_DOCUMENT_STYLE, DEFAULT_PARAGRAPH_STYLES, resolvePageStyle } from "./page-style";
import { resolvedToDocx } from "./to-docx";
import { resolvedToHtml } from "./to-html";
import { resolvedToPdf } from "./to-pdf";
import { resolvedToText } from "./to-text";

const style = () => resolvePageStyle("letter", DEFAULT_DOCUMENT_STYLE, null);

// [page, str, x, y, fontSize]
const PDF_RECORDED = [
  // Re-recorded: 243.3 captured a bug (PDF headings drew regular weight).
  [1, "Re: <b>Notice</b>", 240.9, 705.7, 16],
  [1, "Dear", 247, 678.8, 12],
  [1, "Sam Sample (sample client)", 273.3, 678.8, 12],
  [1, ", <script>alert(1)</script>", 415, 678.8, 12],
  [1, "[Signer bar number — not on file]", 375.4, 665.1, 12],
  [1, "•", 90, 639.3, 12],
  [1, "one", 108, 639.3, 12],
  [1, "•", 90, 613.5, 12],
  [1, "two", 108, 613.5, 12],
  [1, "1.", 90, 587.7, 12],
  [1, "first", 108, 587.7, 12],
  [1, "A", 78.3, 561.4, 12],
  [1, "B", 311.8, 561.4, 12],
  [1, "1", 78.3, 547.1, 12],
  [1, "2", 311.8, 547.1, 12],
  [2, "Page 2", 507.7, 745.9, 12],
  [2, "End", 72, 709.3, 12],
];

const PPR_RECORDED = [
  '<w:pPr><w:pStyle w:val="Heading2"/><w:jc w:val="center"/></w:pPr>',
  '<w:pPr><w:jc w:val="right"/></w:pPr>',
  '<w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr>',
  '<w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr>',
  '<w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr>',
  '<w:pPr><w:spacing w:after="0"/></w:pPr>',
  '<w:pPr><w:spacing w:after="0"/></w:pPr>',
  '<w:pPr><w:spacing w:after="0"/></w:pPr>',
  '<w:pPr><w:spacing w:after="0"/></w:pPr>',
  "",
  "",
];

const HTML_RECORDED =
  '<h2 style="text-align:center">Re: &lt;b&gt;Notice&lt;/b&gt;</h2><p style="text-align:right">Dear <strong>Sam Sample (sample client)</strong>, &lt;script&gt;alert(1)&lt;/script&gt;<br /><mark data-missing>[Signer bar number — not on file]</mark></p><ul><li><p>one</p></li><li><p>two</p></li></ul><ol><li><p>first</p></li></ol><table data-width="full"><colgroup><col style="width:50.00%" /><col style="width:50.00%" /></colgroup><tr><th><p>A</p></th><th><p>B</p></th></tr><tr><td><p>1</p></td><td><p>2</p></td></tr></table><hr data-page-break /><p><em><u>End</u></em></p>';

const TEXT_RECORDED =
  "Re: <b>Notice</b>\n\nDear Sam Sample (sample client), <script>alert(1)</script>\n[Signer bar number — not on file]\n\n- one\n- two\n\n1. first\n\nA\tB\n1\t2\n\nEnd";

describe("existing templates render identically", () => {
  it("PDF text positions and sizes are unchanged", async () => {
    const { buffer } = await resolvedToPdf({
      body: renderFixture(),
      letterhead: null,
      continuation: null,
      style: style(),
    });
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), verbosity: 0 }).promise;
    const out: (string | number)[][] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const tc = await (await pdf.getPage(i)).getTextContent();
      for (const item of tc.items) {
        const t = item as { str: string; transform: number[] };
        if (!t.str.trim()) continue;
        out.push([
          i,
          t.str,
          Math.round(t.transform[4] * 10) / 10,
          Math.round(t.transform[5] * 10) / 10,
          Math.round(t.transform[0] * 10) / 10,
        ]);
      }
    }
    expect(out).toEqual(PDF_RECORDED);
  });

  it("Word paragraph properties are unchanged", async () => {
    const zip = await JSZip.loadAsync(
      await resolvedToDocx({
        body: renderFixture(),
        letterhead: null,
        continuation: null,
        style: style(),
      }),
    );
    const xml = await zip.file("word/document.xml")!.async("string");
    const pprs = [...xml.matchAll(/<w:p>(<w:pPr>.*?<\/w:pPr>)?/g)].map((m) => m[1] ?? "");
    expect(pprs).toEqual(PPR_RECORDED);
  });

  it("HTML and plain text are unchanged", () => {
    expect(resolvedToHtml(renderFixture())).toBe(HTML_RECORDED);
    expect(resolvedToText(renderFixture())).toBe(TEXT_RECORDED);
  });

  it("PDF paragraphs follow their resolved size and bold", async () => {
    const styles = DEFAULT_PARAGRAPH_STYLES;
    const { doc } = renderTemplate(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { style: "heading1" },
            content: [{ type: "text", text: "Big" }],
          },
          { type: "paragraph", content: [{ type: "text", text: "Small" }] },
        ],
      },
      { data: SAMPLE_TEMPLATE_DATA, blocks: new Map(), styles },
    );
    const { buffer } = await resolvedToPdf({
      body: doc,
      letterhead: null,
      continuation: null,
      style: style(),
    });
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), verbosity: 0 }).promise;
    const items = (await (await pdf.getPage(1)).getTextContent()).items as {
      str: string;
      transform: number[];
    }[];
    const size = (s: string) => items.find((i) => i.str === s)!.transform[0];
    expect(size("Big")).toBe(18);
    expect(size("Small")).toBe(12);
  });
});
