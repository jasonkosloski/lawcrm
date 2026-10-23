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
import {
  DEFAULT_DOCUMENT_STYLE,
  DEFAULT_PARAGRAPH_STYLES,
  resolvePageStyle,
  type CourtFormatValues,
} from "./page-style";
import { readStyleOverrides } from "./paragraph-styles";
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

// Re-recorded when paragraph styles went inline: every <p> now carries its
// resolved values (same margins, sizes and alignment the page CSS gave before).
// List items later took their style's 12pt space after (as Word and the PDF
// already did); table cells stay flush.
const HTML_RECORDED =
  '<p style="margin-top:0pt;margin-bottom:12pt;margin-left:0in;margin-right:0in;text-indent:0pt;line-height:1.15;font-size:16pt;font-weight:bold;font-style:normal;text-transform:none;font-variant:normal;text-align:center">Re: &lt;b&gt;Notice&lt;/b&gt;</p><p style="margin-top:0pt;margin-bottom:12pt;margin-left:0in;margin-right:0in;text-indent:0pt;line-height:1.15;font-size:12pt;font-weight:normal;font-style:normal;text-transform:none;font-variant:normal;text-align:right">Dear <strong>Sam Sample (sample client)</strong>, &lt;script&gt;alert(1)&lt;/script&gt;<br /><mark data-missing>[Signer bar number — not on file]</mark></p><ul><li><p style="margin-top:0pt;margin-bottom:12pt;margin-left:0in;margin-right:0in;text-indent:0pt;line-height:1.15;font-size:12pt;font-weight:normal;font-style:normal;text-transform:none;font-variant:normal;text-align:left">one</p></li><li><p style="margin-top:0pt;margin-bottom:12pt;margin-left:0in;margin-right:0in;text-indent:0pt;line-height:1.15;font-size:12pt;font-weight:normal;font-style:normal;text-transform:none;font-variant:normal;text-align:left">two</p></li></ul><ol><li><p style="margin-top:0pt;margin-bottom:12pt;margin-left:0in;margin-right:0in;text-indent:0pt;line-height:1.15;font-size:12pt;font-weight:normal;font-style:normal;text-transform:none;font-variant:normal;text-align:left">first</p></li></ol><table data-width="full"><colgroup><col style="width:50.00%" /><col style="width:50.00%" /></colgroup><tr><th><p style="margin-top:0pt;margin-bottom:0pt;margin-left:0in;margin-right:0in;text-indent:0pt;line-height:1.15;font-size:12pt;font-weight:normal;font-style:normal;text-transform:none;font-variant:normal;text-align:left">A</p></th><th><p style="margin-top:0pt;margin-bottom:0pt;margin-left:0in;margin-right:0in;text-indent:0pt;line-height:1.15;font-size:12pt;font-weight:normal;font-style:normal;text-transform:none;font-variant:normal;text-align:left">B</p></th></tr><tr><td><p style="margin-top:0pt;margin-bottom:0pt;margin-left:0in;margin-right:0in;text-indent:0pt;line-height:1.15;font-size:12pt;font-weight:normal;font-style:normal;text-transform:none;font-variant:normal;text-align:left">1</p></td><td><p style="margin-top:0pt;margin-bottom:0pt;margin-left:0in;margin-right:0in;text-indent:0pt;line-height:1.15;font-size:12pt;font-weight:normal;font-style:normal;text-transform:none;font-variant:normal;text-align:left">2</p></td></tr></table><hr data-page-break /><p style="margin-top:0pt;margin-bottom:12pt;margin-left:0in;margin-right:0in;text-indent:0pt;line-height:1.15;font-size:12pt;font-weight:normal;font-style:normal;text-transform:none;font-variant:normal;text-align:left"><em><u>End</u></em></p>';

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

  it("a legacy-only court (14 pt double) gives filings 20 pt double Heading 1, in styles, Word and PDF", async () => {
    const legacy = { fontSizeHalfPt: 28, lineSpacing: "double", spaceAfterPt: 6 };
    const court: CourtFormatValues = {
      fontKey: null,
      ...legacy,
      marginTopIn: null,
      marginRightIn: null,
      marginBottomIn: null,
      marginLeftIn: null,
      pageNumbers: null,
      paperSize: "letter",
      styleOverrides: readStyleOverrides({}, legacy),
    } as CourtFormatValues;
    const filing = resolvePageStyle("filing", DEFAULT_DOCUMENT_STYLE, null, court);
    const h1 = filing.styles.find((x) => x.key === "heading1")!.values;
    expect([h1.sizePt, h1.lineSpacing, h1.spaceAfterPt]).toEqual([20, "double", 6]);
    expect(filing.styles.find((x) => x.key === "body")!.values.sizePt).toBe(14);

    const { doc } = renderTemplate(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { style: "heading1" },
            content: [{ type: "text", text: "Big" }],
          },
        ],
      },
      { data: SAMPLE_TEMPLATE_DATA, blocks: new Map(), styles: filing.styles },
    );
    const { buffer } = await resolvedToPdf({
      body: doc,
      letterhead: null,
      continuation: null,
      style: filing,
    });
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), verbosity: 0 }).promise;
    const items = (await (await pdf.getPage(1)).getTextContent()).items as {
      str: string;
      transform: number[];
    }[];
    expect(items.find((i) => i.str === "Big")!.transform[0]).toBe(20);

    const zip = await JSZip.loadAsync(
      await resolvedToDocx({ body: doc, letterhead: null, continuation: null, style: filing }),
    );
    const styles = await zip.file("word/styles.xml")!.async("string");
    const h1xml = styles.slice(styles.indexOf('w:styleId="Heading1"'));
    expect(h1xml.slice(0, h1xml.indexOf("</w:style>"))).toMatch(/<w:sz w:val="40"\/>/);
    expect(h1xml.slice(0, h1xml.indexOf("</w:style>"))).toMatch(/w:line="480"/);
  });
});
